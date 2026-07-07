// Domain model. Everything in src/lib is pure: no fs, no electron, no node APIs.

export type AgentId = "claude" | "codex" | "cursor" | "shared";

export type EntityKind =
  | "mcp"
  | "skill"
  | "subagent"
  | "command"
  | "plugin"
  | "settings"
  | "instructions";

export type Scope = { level: "user" } | { level: "project"; projectPath: string };

export interface EntityBase {
  id: string;
  agent: AgentId;
  kind: EntityKind;
  scope: Scope;
  /** Absolute path of the file this entity is read from / written to. */
  filePath: string;
  readOnly: boolean;
}

export type McpTransport = "stdio" | "http" | "sse";

/** Where an MCP server definition lives — determines the write strategy. */
export type McpSource =
  | { kind: "claude-user" } // ~/.claude.json mcpServers
  | { kind: "claude-project"; projectPath: string } // ~/.claude.json projects[P].mcpServers
  | { kind: "mcpjson" } // <project>/.mcp.json
  | { kind: "cursor" } // ~/.cursor/mcp.json or <project>/.cursor/mcp.json
  | { kind: "codex" }; // ~/.codex/config.toml [mcp_servers.*]

export interface McpServerEntity extends EntityBase {
  kind: "mcp";
  name: string;
  source: McpSource;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  startupTimeoutSec?: number;
  /** For .mcp.json servers: gate state from ~/.claude.json enable/disable lists. */
  enabled?: boolean;
  /** Unknown keys carried through verbatim on rewrite. */
  extras: Record<string, unknown>;
}

export interface SkillEntity extends EntityBase {
  kind: "skill";
  name: string;
  description: string;
  version?: string;
  frontmatterExtras: Record<string, unknown>;
  body: string;
}

export interface SubagentEntity extends EntityBase {
  kind: "subagent";
  name: string;
  description: string;
  tools?: string;
  model?: string;
  frontmatterExtras: Record<string, unknown>;
  body: string;
}

export interface CommandEntity extends EntityBase {
  kind: "command";
  name: string;
  description?: string;
  frontmatterExtras: Record<string, unknown>;
  body: string;
}

export interface PluginEntity extends EntityBase {
  kind: "plugin";
  /** "name@marketplace" */
  key: string;
  marketplace: string;
  enabled: boolean;
  version?: string;
  installPath?: string;
}

export type SettingsFormat = "json" | "toml";

export interface SettingsEntity extends EntityBase {
  kind: "settings";
  name: string;
  format: SettingsFormat;
  rawText: string;
  /** Known keys extracted for the quick-edit form (flat dotted keys). */
  known: Record<string, unknown>;
}

export interface InstructionsEntity extends EntityBase {
  kind: "instructions";
  name: string;
  body: string;
}

export type Entity =
  | McpServerEntity
  | SkillEntity
  | SubagentEntity
  | CommandEntity
  | PluginEntity
  | SettingsEntity
  | InstructionsEntity;

// ---- scan / snapshot types ----

export interface FileSnapshot {
  path: string;
  /** null = file does not exist */
  text: string | null;
}

export type SnapshotTag =
  | { t: "claudeGlobalJson" }
  | { t: "claudeSettings"; scope: Scope; local: boolean }
  | { t: "mcpJson"; agent: "claude" | "cursor"; scope: Scope }
  | { t: "codexConfig" }
  | { t: "claudeInstalledPlugins" }
  | { t: "skill"; agent: AgentId; scope: Scope; name: string; readOnly: boolean }
  | { t: "subagent"; agent: AgentId; scope: Scope; name: string }
  | { t: "command"; agent: AgentId; scope: Scope; name: string }
  | { t: "instructions"; agent: AgentId; scope: Scope; name: string; readOnly: boolean };

export interface TaggedSnapshot extends FileSnapshot {
  tag: SnapshotTag;
}

export interface ScanError {
  path: string;
  message: string;
}

export interface ProjectInfo {
  path: string;
  /** Where this project was discovered. */
  sources: ("claude" | "codex" | "manual")[];
  /** Codex trust level, when present in config.toml. */
  codexTrustLevel?: string;
}

export interface Inventory {
  entities: Entity[];
  errors: ScanError[];
  projects: ProjectInfo[];
}

// ---- write side ----

export interface FileEdit {
  path: string;
  /** null = delete the file */
  newText: string | null;
  /** Parent directories to create before writing. */
  createDirs?: string[];
  /** Remove this directory after a delete if it ended up empty (skill dirs). */
  deleteDirIfEmpty?: string;
  /** Values that must be masked in any diff shown to the user. */
  secretValues?: string[];
}
