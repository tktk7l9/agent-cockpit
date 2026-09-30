// Main-process scan against a synthetic home directory on disk: which files
// and directories are read, and how projects are resolved and filtered.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProjects, runScan } from "../src/main/scan";

let home: string;
let project: string;

function write(rel: string, text: string): void {
  const full = path.join(home, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-scan-"));
  project = path.join(home, "src", "demo");
  fs.mkdirSync(project, { recursive: true });
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("resolveProjects", () => {
  it("keeps discovered and manual projects that exist and carry agent config, sorted", () => {
    const other = path.join(home, "src", "other");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "AGENTS.md"), "# x");
    fs.writeFileSync(path.join(project, ".mcp.json"), "{}");
    const empty = path.join(home, "src", "empty");
    fs.mkdirSync(empty, { recursive: true });
    write(".claude.json", JSON.stringify({ projects: { [other]: {}, "/definitely/missing": {} } }));
    write(".codex/config.toml", `[projects."${project}"]\ntrust_level = "trusted"\n`);
    const file = path.join(home, "src", "file.txt");
    fs.writeFileSync(file, "not a dir");
    expect(resolveProjects(home, [empty, file, project])).toEqual([project, other]);
  });

  it("returns nothing when no state files exist", () => {
    expect(resolveProjects(home, [])).toEqual([]);
  });
});

describe("runScan", () => {
  it("collects user-scope and project-scope entities from disk", () => {
    write(".claude.json", JSON.stringify({ mcpServers: { alpha: { command: "npx", args: ["-y", "x"] } }, projects: { [project]: {} } }));
    write(".claude/settings.json", JSON.stringify({ model: "m", permissions: { defaultMode: "plan" } }));
    write(".claude/CLAUDE.md", "# rules");
    write(".claude/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: d\n---\nbody\n");
    write(".claude/skills/.hidden/SKILL.md", "---\nname: hidden\ndescription: d\n---\n");
    write(".claude/skills/stray.txt", "not a skill dir");
    fs.mkdirSync(path.join(home, ".claude/skills/no-skill-file"));
    write(".claude/agents/reviewer.md", "---\nname: reviewer\ndescription: r\n---\nbody\n");
    write(".claude/agents/notes.txt", "ignored");
    fs.mkdirSync(path.join(home, ".claude/agents/subdir"));
    write(".claude/commands/ship.md", "ship\n");
    write(".codex/config.toml", 'model = "fast"\n[mcp_servers.beta]\ncommand = "uvx"\n');
    write(".codex/rules/default.rules", "rule");
    write(".codex/rules/secret_token.rules", "denied");
    write(".codex/rules/readme.txt", "ignored");
    fs.mkdirSync(path.join(home, ".codex/rules/dir.rules"));
    write(".cursor/mcp.json", JSON.stringify({ mcpServers: { gamma: { url: "https://x.test" } } }));
    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "node" } } }));
    fs.writeFileSync(path.join(project, "AGENTS.md"), "# project rules");

    const result = runScan(home, [], "9.9.9");
    expect(result.home).toBe(home);
    expect(result.version).toBe("9.9.9");
    expect(result.errors).toEqual([]);
    expect(result.projects).toEqual([{ path: project, sources: ["claude"] }]);
    const names = result.entities.map((e) => `${e.kind}:${e.agent}:${"name" in e ? e.name : e.key}`).sort();
    expect(names).toEqual([
      "command:claude:ship",
      "instructions:claude:CLAUDE.md",
      "instructions:codex:default.rules",
      "instructions:shared:AGENTS.md",
      "mcp:claude:alpha",
      "mcp:claude:shared",
      "mcp:codex:beta",
      "mcp:cursor:gamma",
      "settings:claude:settings.json",
      "settings:codex:config.toml",
      "skill:claude:deploy",
      "subagent:claude:reviewer",
    ]);
    const rules = result.entities.find((e) => e.kind === "instructions" && e.name === "default.rules");
    expect(rules?.readOnly).toBe(true);
  });

  it("reports unreadable files as errors and drops manual projects that no longer exist", () => {
    write(".claude.json", "{ broken");
    write(".codex/config.toml", "[broken");
    fs.writeFileSync(path.join(project, "CLAUDE.md"), "# p");
    const gone = path.join(home, "gone");
    const result = runScan(home, [project, gone], "1.0.0");
    expect(result.errors.map((e) => e.path).sort()).toEqual([path.join(home, ".claude.json"), path.join(home, ".codex/config.toml")]);
    expect(result.projects).toEqual([{ path: project, sources: ["manual"] }]);
  });
});
