// All known config locations, derived from an injected home directory.
// Nothing in here touches the filesystem — main executes the ScanSpec.

import type { Scope, SnapshotTag } from "./model/types";

export interface ScanFileSpec {
  path: string;
  tag: SnapshotTag;
}

export type DirEntryKind = "skillDirs" | "mdFiles" | "ruleFiles";

export interface ScanDirSpec {
  dir: string;
  type: DirEntryKind;
  makeTag: (name: string) => SnapshotTag;
  /** For skillDirs: path of the file to read inside each subdirectory. */
  fileInDir?: string;
}

export interface ScanSpec {
  files: ScanFileSpec[];
  dirs: ScanDirSpec[];
}

export function claudeGlobalJsonPath(home: string): string {
  return `${home}/.claude.json`;
}

export function claudeDir(home: string): string {
  return `${home}/.claude`;
}

export function codexDir(home: string): string {
  return `${home}/.codex`;
}

export function cursorDir(home: string): string {
  return `${home}/.cursor`;
}

export function codexConfigPath(home: string): string {
  return `${codexDir(home)}/config.toml`;
}

export function skillFilePath(dir: string, name: string): string {
  return `${dir}/${name}/SKILL.md`;
}

const user: Scope = { level: "user" };

function proj(projectPath: string): Scope {
  return { level: "project", projectPath };
}

function skillDir(dir: string, agent: "claude" | "codex" | "cursor", scope: Scope, readOnly = false): ScanDirSpec {
  return {
    dir,
    type: "skillDirs",
    fileInDir: "SKILL.md",
    makeTag: (name) => ({ t: "skill", agent, scope, name, readOnly }),
  };
}

function mdDir(dir: string, t: "subagent" | "command", agent: "claude" | "cursor", scope: Scope): ScanDirSpec {
  return { dir, type: "mdFiles", makeTag: (name) => ({ t, agent, scope, name }) };
}

export function scanSpec(home: string, projectPaths: string[]): ScanSpec {
  const c = claudeDir(home);
  const cx = codexDir(home);
  const cu = cursorDir(home);

  const files: ScanFileSpec[] = [
    { path: claudeGlobalJsonPath(home), tag: { t: "claudeGlobalJson" } },
    { path: `${c}/settings.json`, tag: { t: "claudeSettings", scope: user, local: false } },
    { path: `${c}/settings.local.json`, tag: { t: "claudeSettings", scope: user, local: true } },
    { path: `${c}/plugins/installed_plugins.json`, tag: { t: "claudeInstalledPlugins" } },
    { path: `${c}/CLAUDE.md`, tag: { t: "instructions", agent: "claude", scope: user, name: "CLAUDE.md", readOnly: false } },
    { path: codexConfigPath(home), tag: { t: "codexConfig" } },
    { path: `${cx}/AGENTS.md`, tag: { t: "instructions", agent: "codex", scope: user, name: "AGENTS.md", readOnly: false } },
    { path: `${cu}/mcp.json`, tag: { t: "mcpJson", agent: "cursor", scope: user } },
  ];

  const dirs: ScanDirSpec[] = [
    skillDir(`${c}/skills`, "claude", user),
    skillDir(`${cx}/skills`, "codex", user),
    skillDir(`${cu}/skills`, "cursor", user),
    skillDir(`${cu}/skills-cursor`, "cursor", user, true),
    mdDir(`${c}/agents`, "subagent", "claude", user),
    mdDir(`${cu}/agents`, "subagent", "cursor", user),
    mdDir(`${c}/commands`, "command", "claude", user),
    {
      dir: `${cx}/rules`,
      type: "ruleFiles",
      makeTag: (name) => ({ t: "instructions", agent: "codex", scope: user, name, readOnly: true }),
    },
  ];

  for (const p of projectPaths) {
    const scope = proj(p);
    files.push(
      { path: `${p}/.mcp.json`, tag: { t: "mcpJson", agent: "claude", scope } },
      { path: `${p}/.cursor/mcp.json`, tag: { t: "mcpJson", agent: "cursor", scope } },
      { path: `${p}/.claude/settings.json`, tag: { t: "claudeSettings", scope, local: false } },
      { path: `${p}/.claude/settings.local.json`, tag: { t: "claudeSettings", scope, local: true } },
      { path: `${p}/CLAUDE.md`, tag: { t: "instructions", agent: "claude", scope, name: "CLAUDE.md", readOnly: false } },
      { path: `${p}/AGENTS.md`, tag: { t: "instructions", agent: "shared", scope, name: "AGENTS.md", readOnly: false } },
    );
    dirs.push(
      skillDir(`${p}/.claude/skills`, "claude", scope),
      mdDir(`${p}/.claude/agents`, "subagent", "claude", scope),
      mdDir(`${p}/.claude/commands`, "command", "claude", scope),
    );
  }

  return { files, dirs };
}

/** Directories/files the main-process watcher should observe. */
export function watchPaths(home: string, projectPaths: string[]): string[] {
  const spec = scanSpec(home, projectPaths);
  const set = new Set<string>();
  for (const f of spec.files) set.add(f.path);
  for (const d of spec.dirs) set.add(d.dir);
  return [...set];
}

// ---- path access control (pure decision logic; main resolves realpaths first) ----

const DENY_BASENAMES = [/^auth\.json$/i, /^\.env/i, /credential/i, /secret/i, /^.+_token/i];

export function isPathDenied(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return DENY_BASENAMES.some((re) => re.test(base));
}

export function allowedRoots(home: string, projectPaths: string[]): string[] {
  return [claudeGlobalJsonPath(home), claudeDir(home), codexDir(home), cursorDir(home), ...projectPaths];
}

export function isPathAllowed(home: string, projectPaths: string[], path: string): boolean {
  if (path.includes("..")) return false;
  if (isPathDenied(path)) return false;
  return allowedRoots(home, projectPaths).some((root) => path === root || path.startsWith(`${root}/`));
}
