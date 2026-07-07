// Builds the unified entity inventory from tagged file snapshots.
// Pure: main collects snapshots (fs) and calls buildInventory.

import {
  claudeEnabledPlugins,
  claudeSettingsKnown,
  parseClaudeGlobal,
  parseInstalledPlugins,
  parseMcpJsonFile,
  type ClaudeGlobal,
} from "./agents/claude";
import { parseCodexConfig, type CodexConfig } from "./agents/codex";
import { normalizeMcp } from "./agents/mcp-common";
import { errorMessage } from "./errors";
import { parseFrontmatter } from "./markdown/frontmatter";
import { entityId } from "./model/ids";
import type {
  AgentId,
  Entity,
  Inventory,
  McpServerEntity,
  McpSource,
  ProjectInfo,
  ScanError,
  Scope,
  TaggedSnapshot,
} from "./model/types";

const USER: Scope = { level: "user" };

function mcpEntity(
  agent: AgentId,
  scope: Scope,
  name: string,
  raw: Record<string, unknown>,
  source: McpSource,
  filePath: string,
  enabled?: boolean,
): McpServerEntity {
  const n = normalizeMcp(raw);
  return {
    id: entityId(agent, "mcp", scope, name),
    agent,
    kind: "mcp",
    scope,
    filePath,
    readOnly: false,
    name,
    source,
    transport: n.transport,
    command: n.command,
    args: n.args,
    env: n.env,
    url: n.url,
    headers: n.headers,
    startupTimeoutSec: n.startupTimeoutSec,
    enabled,
    extras: n.extras,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function buildInventory(snaps: TaggedSnapshot[], manualProjects: string[]): Inventory {
  const errors: ScanError[] = [];
  const entities: Entity[] = [];

  const fail = (path: string, e: unknown): void => {
    errors.push({ path, message: errorMessage(e) });
  };

  // -- pre-pass: cross-file inputs --
  const globalSnap = snaps.find((s) => s.tag.t === "claudeGlobalJson");
  let claudeGlobal: ClaudeGlobal = { mcpServers: {}, projects: {} };
  if (globalSnap && globalSnap.text !== null) {
    try {
      claudeGlobal = parseClaudeGlobal(globalSnap.text);
    } catch (e) {
      fail(globalSnap.path, e);
    }
  }

  const codexSnap = snaps.find((s) => s.tag.t === "codexConfig");
  let codex: CodexConfig = { mcpServers: {}, plugins: {}, projects: {}, known: {} };
  if (codexSnap && codexSnap.text !== null) {
    try {
      codex = parseCodexConfig(codexSnap.text);
    } catch (e) {
      fail(codexSnap.path, e);
    }
  }

  const userSettingsSnap = snaps.find((s) => s.tag.t === "claudeSettings" && !s.tag.local && s.tag.scope.level === "user");
  let enabledPlugins: Record<string, boolean> = {};
  if (userSettingsSnap && userSettingsSnap.text !== null) {
    try {
      enabledPlugins = claudeEnabledPlugins(userSettingsSnap.text);
    } catch {
      // reported below when the settings snapshot itself is processed
    }
  }

  // -- claude global: user + project MCP servers --
  if (globalSnap && globalSnap.text !== null) {
    for (const [name, raw] of Object.entries(claudeGlobal.mcpServers)) {
      entities.push(mcpEntity("claude", USER, name, raw, { kind: "claude-user" }, globalSnap.path));
    }
    for (const [projectPath, cfg] of Object.entries(claudeGlobal.projects)) {
      const scope: Scope = { level: "project", projectPath };
      for (const [name, raw] of Object.entries(cfg.mcpServers)) {
        entities.push(mcpEntity("claude", scope, name, raw, { kind: "claude-project", projectPath }, globalSnap.path));
      }
    }
  }

  // -- codex config: MCP servers + plugins + settings --
  if (codexSnap && codexSnap.text !== null) {
    for (const [name, raw] of Object.entries(codex.mcpServers)) {
      entities.push(mcpEntity("codex", USER, name, raw, { kind: "codex" }, codexSnap.path));
    }
    for (const [key, enabled] of Object.entries(codex.plugins)) {
      const at = key.lastIndexOf("@");
      entities.push({
        id: entityId("codex", "plugin", USER, key),
        agent: "codex",
        kind: "plugin",
        scope: USER,
        filePath: codexSnap.path,
        readOnly: false,
        key,
        marketplace: at > 0 ? key.slice(at + 1) : "",
        enabled,
      });
    }
    entities.push({
      id: entityId("codex", "settings", USER, "config.toml"),
      agent: "codex",
      kind: "settings",
      scope: USER,
      filePath: codexSnap.path,
      readOnly: false,
      name: "config.toml",
      format: "toml",
      rawText: codexSnap.text,
      known: codex.known,
    });
  }

  // -- claude plugins: union of enabled map + installed metadata --
  const installedSnap = snaps.find((s) => s.tag.t === "claudeInstalledPlugins");
  if (userSettingsSnap && userSettingsSnap.text !== null) {
    let installed: ReturnType<typeof parseInstalledPlugins> = {};
    if (installedSnap && installedSnap.text !== null) {
      try {
        installed = parseInstalledPlugins(installedSnap.text);
      } catch (e) {
        fail(installedSnap.path, e);
      }
    }
    const keys = new Set([...Object.keys(enabledPlugins), ...Object.keys(installed)]);
    for (const key of keys) {
      const at = key.lastIndexOf("@");
      entities.push({
        id: entityId("claude", "plugin", USER, key),
        agent: "claude",
        kind: "plugin",
        scope: USER,
        filePath: userSettingsSnap.path,
        readOnly: false,
        key,
        marketplace: at > 0 ? key.slice(at + 1) : "",
        enabled: enabledPlugins[key] === true,
        version: installed[key]?.version,
        installPath: installed[key]?.installPath,
      });
    }
  }

  // -- per-file tags --
  for (const snap of snaps) {
    if (snap.text === null) continue;
    const tag = snap.tag;
    try {
      switch (tag.t) {
        case "claudeSettings": {
          entities.push({
            id: entityId("claude", "settings", tag.scope, tag.local ? "settings.local.json" : "settings.json"),
            agent: "claude",
            kind: "settings",
            scope: tag.scope,
            filePath: snap.path,
            readOnly: false,
            name: tag.local ? "settings.local.json" : "settings.json",
            format: "json",
            rawText: snap.text,
            known: claudeSettingsKnown(snap.text),
          });
          break;
        }
        case "mcpJson": {
          const servers = parseMcpJsonFile(snap.text);
          const gates = tag.agent === "claude" && tag.scope.level === "project" ? claudeGlobal.projects[tag.scope.projectPath] : undefined;
          for (const [name, raw] of Object.entries(servers)) {
            const enabled = gates ? !gates.disabledMcpjsonServers.includes(name) : undefined;
            const source: McpSource = tag.agent === "claude" ? { kind: "mcpjson" } : { kind: "cursor" };
            entities.push(mcpEntity(tag.agent, tag.scope, name, raw, source, snap.path, enabled));
          }
          break;
        }
        case "skill": {
          const fm = parseFrontmatter(snap.text);
          entities.push({
            id: entityId(tag.agent, "skill", tag.scope, tag.name),
            agent: tag.agent,
            kind: "skill",
            scope: tag.scope,
            filePath: snap.path,
            readOnly: tag.readOnly,
            name: str(fm.data["name"]) ?? tag.name,
            description: str(fm.data["description"]) ?? "",
            version: str(fm.data["version"]),
            frontmatterExtras: Object.fromEntries(
              Object.entries(fm.data).filter(([k]) => !["name", "description", "version"].includes(k)),
            ),
            body: fm.body,
          });
          break;
        }
        case "subagent": {
          const fm = parseFrontmatter(snap.text);
          entities.push({
            id: entityId(tag.agent, "subagent", tag.scope, tag.name),
            agent: tag.agent,
            kind: "subagent",
            scope: tag.scope,
            filePath: snap.path,
            readOnly: false,
            name: str(fm.data["name"]) ?? tag.name,
            description: str(fm.data["description"]) ?? "",
            tools: str(fm.data["tools"]),
            model: str(fm.data["model"]),
            frontmatterExtras: Object.fromEntries(
              Object.entries(fm.data).filter(([k]) => !["name", "description", "tools", "model"].includes(k)),
            ),
            body: fm.body,
          });
          break;
        }
        case "command": {
          const fm = parseFrontmatter(snap.text);
          entities.push({
            id: entityId(tag.agent, "command", tag.scope, tag.name),
            agent: tag.agent,
            kind: "command",
            scope: tag.scope,
            filePath: snap.path,
            readOnly: false,
            name: tag.name,
            description: str(fm.data["description"]),
            frontmatterExtras: Object.fromEntries(Object.entries(fm.data).filter(([k]) => k !== "description")),
            body: fm.body,
          });
          break;
        }
        case "instructions": {
          entities.push({
            id: entityId(tag.agent, "instructions", tag.scope, tag.name),
            agent: tag.agent,
            kind: "instructions",
            scope: tag.scope,
            filePath: snap.path,
            readOnly: tag.readOnly,
            name: tag.name,
            body: snap.text,
          });
          break;
        }
        case "claudeGlobalJson":
        case "codexConfig":
        case "claudeInstalledPlugins":
          break; // handled in the pre-pass
      }
    } catch (e) {
      fail(snap.path, e);
    }
  }

  // -- projects --
  const projects = new Map<string, ProjectInfo>();
  const add = (path: string, source: "claude" | "codex" | "manual", trustLevel?: string): void => {
    const existing = projects.get(path);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (trustLevel !== undefined) existing.codexTrustLevel = trustLevel;
      return;
    }
    projects.set(path, { path, sources: [source], codexTrustLevel: trustLevel });
  };
  for (const path of Object.keys(claudeGlobal.projects)) add(path, "claude");
  for (const [path, info] of Object.entries(codex.projects)) add(path, "codex", info.trustLevel);
  for (const path of manualProjects) add(path, "manual");

  return { entities, errors, projects: [...projects.values()] };
}

/** Candidate project paths discovered from agent state files (main filters by fs existence). */
export function discoverProjects(claudeGlobalText: string | null, codexConfigText: string | null): string[] {
  const out = new Set<string>();
  try {
    for (const path of Object.keys(parseClaudeGlobal(claudeGlobalText).projects)) out.add(path);
  } catch {
    // unreadable state file — nothing to discover
  }
  try {
    for (const path of Object.keys(parseCodexConfig(codexConfigText).projects)) out.add(path);
  } catch {
    // ignore
  }
  return [...out];
}

/** Files whose presence makes a directory an interesting "project" for the app. */
export function projectMarkers(projectPath: string): string[] {
  return [
    `${projectPath}/.mcp.json`,
    `${projectPath}/.claude`,
    `${projectPath}/.cursor`,
    `${projectPath}/CLAUDE.md`,
    `${projectPath}/AGENTS.md`,
  ];
}
