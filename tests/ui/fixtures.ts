// Synthetic entities for renderer tests — never real config values.

import type {
  CommandEntity,
  InstructionsEntity,
  McpServerEntity,
  PluginEntity,
  ProjectInfo,
  SettingsEntity,
  SkillEntity,
  SubagentEntity,
} from "../../src/lib/model/types";
import type { ScanResultPayload } from "../../src/shared/ipc";

export const HOME = "/Users/test";
export const PROJECT = "/Users/test/src/demo-app";

export function makeData(partial: Partial<ScanResultPayload> = {}): ScanResultPayload {
  return { home: HOME, version: "0.1.0", entities: [], errors: [], projects: [], ...partial };
}

export function project(path = PROJECT, partial: Partial<ProjectInfo> = {}): ProjectInfo {
  return { path, sources: ["claude"], ...partial };
}

export function mcp(partial: Partial<McpServerEntity> = {}): McpServerEntity {
  return {
    id: "mcp:claude-user:alpha",
    agent: "claude",
    kind: "mcp",
    scope: { level: "user" },
    filePath: `${HOME}/.claude.json`,
    readOnly: false,
    name: "alpha",
    source: { kind: "claude-user" },
    transport: "stdio",
    command: "npx",
    args: ["-y", "@demo/alpha"],
    env: {},
    extras: {},
    ...partial,
  };
}

export function skill(partial: Partial<SkillEntity> = {}): SkillEntity {
  return {
    id: "skill:claude:user:deploy",
    agent: "claude",
    kind: "skill",
    scope: { level: "user" },
    filePath: `${HOME}/.claude/skills/deploy/SKILL.md`,
    readOnly: false,
    name: "deploy",
    description: "Deploy the app",
    frontmatterExtras: {},
    body: "# Deploy\n\nRun the deploy script.\n",
    ...partial,
  };
}

export function subagent(partial: Partial<SubagentEntity> = {}): SubagentEntity {
  return {
    id: "subagent:claude:user:reviewer",
    agent: "claude",
    kind: "subagent",
    scope: { level: "user" },
    filePath: `${HOME}/.claude/agents/reviewer.md`,
    readOnly: false,
    name: "reviewer",
    description: "Reviews code",
    frontmatterExtras: {},
    body: "You review code.\n",
    ...partial,
  };
}

export function command(partial: Partial<CommandEntity> = {}): CommandEntity {
  return {
    id: "command:claude:user:ship",
    agent: "claude",
    kind: "command",
    scope: { level: "user" },
    filePath: `${HOME}/.claude/commands/ship.md`,
    readOnly: false,
    name: "ship",
    description: "Ship it",
    frontmatterExtras: {},
    body: "Ship the current branch.\n",
    ...partial,
  };
}

export function plugin(partial: Partial<PluginEntity> = {}): PluginEntity {
  return {
    id: "plugin:claude:linter@market",
    agent: "claude",
    kind: "plugin",
    scope: { level: "user" },
    filePath: `${HOME}/.claude/settings.json`,
    readOnly: false,
    key: "linter@market",
    marketplace: "market",
    enabled: true,
    version: "1.2.3",
    ...partial,
  };
}

export function settings(partial: Partial<SettingsEntity> = {}): SettingsEntity {
  return {
    id: "settings:claude:user",
    agent: "claude",
    kind: "settings",
    scope: { level: "user" },
    filePath: `${HOME}/.claude/settings.json`,
    readOnly: false,
    name: "settings.json",
    format: "json",
    rawText: '{\n  "permissions": { "defaultMode": "plan", "allow": ["Bash(ls)"], "deny": [] },\n  "model": "opus"\n}\n',
    known: { model: "opus" },
    ...partial,
  };
}

export function instructions(partial: Partial<InstructionsEntity> = {}): InstructionsEntity {
  return {
    id: "instructions:claude:user",
    agent: "claude",
    kind: "instructions",
    scope: { level: "user" },
    filePath: `${HOME}/.claude/CLAUDE.md`,
    readOnly: false,
    name: "CLAUDE.md",
    body: "# Rules\n",
    ...partial,
  };
}
