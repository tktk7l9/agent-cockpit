// Every write in the app funnels through planMutation: (current file texts,
// mutation) -> FileEdit[]. Pure; main is responsible for reading snapshots,
// diff preview, hash checks, backups and atomic writes.

import { parseClaudeGlobal, parseMcpJsonFile } from "./agents/claude";
import { parseCodexConfig } from "./agents/codex";
import { denormalizeMcpJson, mcpSecretValues, normalizeMcp, type McpInput } from "./agents/mcp-common";
import { isJsonParseable, removeJsonKey, setJsonValue, type JsonPathSegment } from "./json/jsonc-edit";
import { buildFrontmatterFile, parseFrontmatter, updateFrontmatter } from "./markdown/frontmatter";
import type { FileEdit, SettingsFormat } from "./model/types";
import {
  assertValidToml,
  removeTables,
  setKeyInTable,
  setTopLevelKey,
  tomlHeader,
  tomlKey,
  tomlValue,
  upsertTableBlock,
} from "./toml/toml-edit";
import { validateMcpInput, validateSkillInput, validateEntityName } from "./validate";

export type McpTargetRef =
  | { kind: "claude-user"; filePath: string }
  | { kind: "claude-project"; filePath: string; projectPath: string }
  | { kind: "mcpjson"; filePath: string }
  | { kind: "cursor"; filePath: string }
  | { kind: "codex"; filePath: string };

export type Mutation =
  | { op: "upsertMcp"; target: McpTargetRef; prevName?: string; input: McpInput }
  | { op: "deleteMcp"; target: McpTargetRef; name: string }
  | {
      op: "upsertSkill";
      dir: string;
      name: string;
      prevName?: string;
      description: string;
      version?: string;
      body: string;
    }
  | { op: "deleteSkill"; filePath: string; skillDir: string }
  | {
      op: "upsertMarkdown";
      kind: "subagent" | "command";
      dir: string;
      name: string;
      prevName?: string;
      frontmatter: Record<string, unknown>;
      body: string;
    }
  | { op: "deleteFile"; filePath: string }
  | { op: "togglePlugin"; agent: "claude" | "codex"; filePath: string; key: string; enabled: boolean }
  | { op: "setSetting"; filePath: string; format: SettingsFormat; keyPath: string[]; value: unknown }
  | { op: "writeRaw"; filePath: string; format: SettingsFormat | "markdown"; newText: string };

export interface PlanContext {
  /** Current text of a file, or null when it does not exist. */
  snapshot(path: string): string | null;
}

function invalid(errors: string[]): Error {
  return new Error(errors.join("; "));
}

// ---- MCP ----

function mcpJsonPath(target: McpTargetRef, name: string): JsonPathSegment[] {
  if (target.kind === "claude-project") return ["projects", target.projectPath, "mcpServers", name];
  return ["mcpServers", name];
}

function codexMcpBlock(input: McpInput): string {
  const lines: string[] = [tomlHeader(["mcp_servers", input.name])];
  if (input.transport === "stdio") {
    lines.push(`command = ${tomlValue(input.command)}`);
    if (input.args && input.args.length > 0) lines.push(`args = ${tomlValue(input.args)}`);
  } else {
    lines.push(`url = ${tomlValue(input.url)}`);
  }
  if (input.startupTimeoutSec !== undefined) lines.push(`startup_timeout_sec = ${tomlValue(input.startupTimeoutSec)}`);
  for (const [k, v] of Object.entries(input.extras ?? {})) {
    lines.push(`${tomlKey(k)} = ${tomlValue(v)}`);
  }
  const env = Object.entries(input.env ?? {});
  if (env.length > 0) {
    lines.push("", tomlHeader(["mcp_servers", input.name, "env"]));
    for (const [k, v] of env) lines.push(`${tomlKey(k)} = ${tomlValue(v)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Existing env/header values for the server being replaced (for diff masking). */
function oldMcpSecrets(text: string | null, target: McpTargetRef, name: string): string[] {
  if (text === null) return [];
  let raw: Record<string, unknown> | undefined;
  if (target.kind === "codex") {
    raw = parseCodexConfig(text).mcpServers[name];
  } else if (target.kind === "claude-user") {
    raw = parseClaudeGlobal(text).mcpServers[name];
  } else if (target.kind === "claude-project") {
    raw = parseClaudeGlobal(text).projects[target.projectPath]?.mcpServers[name];
  } else {
    raw = parseMcpJsonFile(text)[name];
  }
  if (!raw) return [];
  const n = normalizeMcp(raw);
  return mcpSecretValues(n.env, n.headers);
}

function planUpsertMcp(ctx: PlanContext, m: Extract<Mutation, { op: "upsertMcp" }>): FileEdit[] {
  const errors = validateMcpInput(m.input);
  if (errors.length > 0) throw invalid(errors);
  const text = ctx.snapshot(m.target.filePath);
  const rename = m.prevName !== undefined && m.prevName !== m.input.name;
  const secretValues = [
    ...mcpSecretValues(m.input.env, m.input.headers),
    ...oldMcpSecrets(text, m.target, m.prevName ?? m.input.name),
  ];
  let newText: string;
  if (m.target.kind === "codex") {
    const base = text ?? "";
    const afterRemove = rename ? removeTables(base, ["mcp_servers", m.prevName as string]) : base;
    newText = upsertTableBlock(afterRemove, ["mcp_servers", m.input.name], codexMcpBlock(m.input));
  } else {
    const afterRemove = rename ? removeJsonKey(text, mcpJsonPath(m.target, m.prevName as string)) : text;
    newText = setJsonValue(afterRemove, mcpJsonPath(m.target, m.input.name), denormalizeMcpJson(m.input));
  }
  return [{ path: m.target.filePath, newText, secretValues }];
}

function planDeleteMcp(ctx: PlanContext, m: Extract<Mutation, { op: "deleteMcp" }>): FileEdit[] {
  const text = ctx.snapshot(m.target.filePath);
  if (text === null) throw new Error(`file not found: ${m.target.filePath}`);
  const secretValues = oldMcpSecrets(text, m.target, m.name);
  const newText =
    m.target.kind === "codex"
      ? removeTables(text, ["mcp_servers", m.name])
      : removeJsonKey(text, mcpJsonPath(m.target, m.name));
  return [{ path: m.target.filePath, newText, secretValues }];
}

// ---- markdown-based entities ----

function planUpsertSkill(ctx: PlanContext, m: Extract<Mutation, { op: "upsertSkill" }>): FileEdit[] {
  const errors = validateSkillInput(m.name, m.description);
  if (errors.length > 0) throw invalid(errors);
  const newPath = `${m.dir}/${m.name}/SKILL.md`;
  const oldName = m.prevName ?? m.name;
  const oldPath = `${m.dir}/${oldName}/SKILL.md`;
  const existing = ctx.snapshot(oldPath);
  const fm: Record<string, unknown> = {
    name: m.name,
    description: m.description,
    version: m.version === undefined || m.version === "" ? undefined : m.version,
  };
  let content: string;
  if (existing !== null) {
    const updated = updateFrontmatter(existing, fm);
    const parsed = parseFrontmatter(updated);
    content = updated.slice(0, updated.length - parsed.body.length) + m.body;
  } else {
    content = buildFrontmatterFile(
      Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== undefined)),
      m.body,
    );
  }
  const edits: FileEdit[] = [{ path: newPath, newText: content, createDirs: [`${m.dir}/${m.name}`] }];
  if (oldPath !== newPath && existing !== null) {
    edits.push({ path: oldPath, newText: null, deleteDirIfEmpty: `${m.dir}/${oldName}` });
  }
  return edits;
}

function planUpsertMarkdown(ctx: PlanContext, m: Extract<Mutation, { op: "upsertMarkdown" }>): FileEdit[] {
  const errors = validateEntityName(m.name);
  if (errors.length > 0) throw invalid(errors);
  const newPath = `${m.dir}/${m.name}.md`;
  const oldName = m.prevName ?? m.name;
  const oldPath = `${m.dir}/${oldName}.md`;
  const existing = ctx.snapshot(oldPath);
  const definedFm = Object.fromEntries(Object.entries(m.frontmatter).filter(([, v]) => v !== undefined));
  let content: string;
  if (existing !== null) {
    const updated = updateFrontmatter(existing, m.frontmatter);
    const parsed = parseFrontmatter(updated);
    content = updated.slice(0, updated.length - parsed.body.length) + m.body;
  } else if (Object.keys(definedFm).length === 0) {
    content = m.body === "" || m.body.endsWith("\n") ? m.body : `${m.body}\n`;
  } else {
    content = buildFrontmatterFile(definedFm, m.body);
  }
  const edits: FileEdit[] = [{ path: newPath, newText: content, createDirs: [m.dir] }];
  if (oldPath !== newPath && existing !== null) {
    edits.push({ path: oldPath, newText: null });
  }
  return edits;
}

// ---- settings / raw ----

function planSetSetting(ctx: PlanContext, m: Extract<Mutation, { op: "setSetting" }>): FileEdit[] {
  const text = ctx.snapshot(m.filePath);
  if (m.format === "json") {
    return [{ path: m.filePath, newText: setJsonValue(text, m.keyPath, m.value) }];
  }
  if (m.keyPath.length !== 1) throw new Error("toml quick-edit supports top-level keys only");
  return [{ path: m.filePath, newText: setTopLevelKey(text ?? "", m.keyPath[0] as string, m.value) }];
}

function planWriteRaw(m: Extract<Mutation, { op: "writeRaw" }>): FileEdit[] {
  if (m.format === "json" && !isJsonParseable(m.newText)) throw new Error("not valid JSON — fix before saving");
  if (m.format === "toml") assertValidToml(m.newText);
  return [{ path: m.filePath, newText: m.newText }];
}

function planTogglePlugin(ctx: PlanContext, m: Extract<Mutation, { op: "togglePlugin" }>): FileEdit[] {
  const text = ctx.snapshot(m.filePath);
  if (m.agent === "claude") {
    return [{ path: m.filePath, newText: setJsonValue(text, ["enabledPlugins", m.key], m.enabled) }];
  }
  return [{ path: m.filePath, newText: setKeyInTable(text ?? "", ["plugins", m.key], "enabled", m.enabled) }];
}

export function planMutation(ctx: PlanContext, m: Mutation): FileEdit[] {
  switch (m.op) {
    case "upsertMcp":
      return planUpsertMcp(ctx, m);
    case "deleteMcp":
      return planDeleteMcp(ctx, m);
    case "upsertSkill":
      return planUpsertSkill(ctx, m);
    case "deleteSkill":
      return [{ path: m.filePath, newText: null, deleteDirIfEmpty: m.skillDir }];
    case "upsertMarkdown":
      return planUpsertMarkdown(ctx, m);
    case "deleteFile":
      return [{ path: m.filePath, newText: null }];
    case "togglePlugin":
      return planTogglePlugin(ctx, m);
    case "setSetting":
      return planSetSetting(ctx, m);
    case "writeRaw":
      return planWriteRaw(m);
  }
}

/** Paths whose current content planMutation will consult — main snapshots these. */
export function mutationReadPaths(m: Mutation): string[] {
  switch (m.op) {
    case "upsertMcp":
      return [m.target.filePath];
    case "deleteMcp":
      return [m.target.filePath];
    case "upsertSkill":
      return [`${m.dir}/${m.prevName ?? m.name}/SKILL.md`, `${m.dir}/${m.name}/SKILL.md`];
    case "deleteSkill":
      return [m.filePath];
    case "upsertMarkdown":
      return [`${m.dir}/${m.prevName ?? m.name}.md`, `${m.dir}/${m.name}.md`];
    case "deleteFile":
      return [m.filePath];
    case "togglePlugin":
      return [m.filePath];
    case "setSetting":
      return [m.filePath];
    case "writeRaw":
      return [m.filePath];
  }
}
