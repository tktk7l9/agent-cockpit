import { describe, expect, it } from "vitest";
import { parseJsonText } from "../src/lib/json/jsonc-edit";
import type { FileEdit } from "../src/lib/model/types";
import { mutationReadPaths, planMutation, type Mutation, type PlanContext } from "../src/lib/mutations";

function ctx(files: Record<string, string | null>): PlanContext {
  return { snapshot: (p) => files[p] ?? null };
}

function only(edits: FileEdit[]): FileEdit {
  expect(edits).toHaveLength(1);
  return edits[0] as FileEdit;
}

const CLAUDE_JSON = JSON.stringify(
  {
    decoy: { a: 1 },
    mcpServers: { keyway: { type: "stdio", command: "npx", env: { TOKEN: "old-secret-value" } } },
    projects: { "/proj": { mcpServers: { mdn: { type: "http", url: "https://mdn" } } } },
  },
  null,
  2,
);

const CODEX_TOML = `# keep me
model = "gpt-5.2"

[mcp_servers.node_repl]
command = "node"

[mcp_servers.node_repl.env]
TOKEN = "codex-secret-1"

[plugins."browser@openai-bundled"]
enabled = true
`;

describe("upsertMcp", () => {
  it("adds a server to ~/.claude.json without touching other keys", () => {
    const m: Mutation = {
      op: "upsertMcp",
      target: { kind: "claude-user", filePath: "/h/.claude.json" },
      input: { name: "newsrv", transport: "stdio", command: "npx", args: ["-y"], env: { K: "new-secret-9" } },
    };
    const edit = only(planMutation(ctx({ "/h/.claude.json": CLAUDE_JSON }), m));
    const parsed = parseJsonText(edit.newText) as Record<string, Record<string, unknown>>;
    expect(parsed["mcpServers"]?.["newsrv"]).toEqual({ type: "stdio", command: "npx", args: ["-y"], env: { K: "new-secret-9" } });
    expect(parsed["decoy"]).toEqual({ a: 1 });
    expect(edit.secretValues).toContain("new-secret-9");
  });

  it("renames a server (removes old key) and masks old secrets", () => {
    const m: Mutation = {
      op: "upsertMcp",
      target: { kind: "claude-user", filePath: "/h/.claude.json" },
      prevName: "keyway",
      input: { name: "keyway2", transport: "stdio", command: "npx" },
    };
    const edit = only(planMutation(ctx({ "/h/.claude.json": CLAUDE_JSON }), m));
    const parsed = parseJsonText(edit.newText) as Record<string, Record<string, unknown>>;
    expect(parsed["mcpServers"]?.["keyway"]).toBeUndefined();
    expect(parsed["mcpServers"]?.["keyway2"]).toBeDefined();
    expect(edit.secretValues).toContain("old-secret-value");
  });

  it("writes into a project subtree of ~/.claude.json", () => {
    const m: Mutation = {
      op: "upsertMcp",
      target: { kind: "claude-project", filePath: "/h/.claude.json", projectPath: "/proj" },
      prevName: "mdn",
      input: { name: "mdn", transport: "http", url: "https://mdn2" },
    };
    const edit = only(planMutation(ctx({ "/h/.claude.json": CLAUDE_JSON }), m));
    const parsed = parseJsonText(edit.newText) as never as {
      projects: Record<string, { mcpServers: Record<string, { url: string }> }>;
    };
    expect(parsed.projects["/proj"]?.mcpServers["mdn"]?.url).toBe("https://mdn2");
  });

  it("creates .mcp.json / cursor mcp.json from nothing", () => {
    for (const kind of ["mcpjson", "cursor"] as const) {
      const m: Mutation = {
        op: "upsertMcp",
        target: { kind, filePath: "/p/.mcp.json" },
        input: { name: "s", transport: "http", url: "https://x", headers: { Authorization: "Bearer tok-12345" } },
      };
      const edit = only(planMutation(ctx({}), m));
      const parsed = parseJsonText(edit.newText) as Record<string, Record<string, unknown>>;
      expect(parsed["mcpServers"]?.["s"]).toEqual({ type: "http", url: "https://x", headers: { Authorization: "Bearer tok-12345" } });
      expect(edit.secretValues).toContain("Bearer tok-12345");
    }
  });

  it("upserts a codex server block with env subtable", () => {
    const m: Mutation = {
      op: "upsertMcp",
      target: { kind: "codex", filePath: "/h/.codex/config.toml" },
      input: {
        name: "newsrv",
        transport: "stdio",
        command: "npx",
        args: ["-y", "srv"],
        env: { API_KEY: "codex-new-secret" },
        startupTimeoutSec: 20,
        extras: { note: "hi" },
      },
    };
    const edit = only(planMutation(ctx({ "/h/.codex/config.toml": CODEX_TOML }), m));
    expect(edit.newText).toContain("[mcp_servers.newsrv]");
    expect(edit.newText).toContain('args = ["-y", "srv"]');
    expect(edit.newText).toContain("startup_timeout_sec = 20");
    expect(edit.newText).toContain("[mcp_servers.newsrv.env]");
    expect(edit.newText).toContain('note = "hi"');
    expect(edit.newText).toContain("# keep me");
    expect(edit.secretValues).toContain("codex-new-secret");
  });

  it("renames a codex server and writes remote servers", () => {
    const m: Mutation = {
      op: "upsertMcp",
      target: { kind: "codex", filePath: "/c.toml" },
      prevName: "node_repl",
      input: { name: "repl2", transport: "http", url: "https://remote" },
    };
    const edit = only(planMutation(ctx({ "/c.toml": CODEX_TOML }), m));
    expect(edit.newText).not.toContain("[mcp_servers.node_repl]");
    expect(edit.newText).toContain("[mcp_servers.repl2]");
    expect(edit.newText).toContain('url = "https://remote"');
    expect(edit.secretValues).toContain("codex-secret-1");
  });

  it("rejects invalid input", () => {
    const m: Mutation = {
      op: "upsertMcp",
      target: { kind: "claude-user", filePath: "/f" },
      input: { name: "bad name", transport: "stdio" },
    };
    expect(() => planMutation(ctx({}), m)).toThrow(/name|command/);
  });
});

describe("deleteMcp", () => {
  it("deletes from JSON targets", () => {
    const m: Mutation = { op: "deleteMcp", target: { kind: "claude-user", filePath: "/h/.claude.json" }, name: "keyway" };
    const edit = only(planMutation(ctx({ "/h/.claude.json": CLAUDE_JSON }), m));
    const parsed = parseJsonText(edit.newText) as Record<string, Record<string, unknown>>;
    expect(parsed["mcpServers"]).toEqual({});
    expect(edit.secretValues).toContain("old-secret-value");
  });

  it("deletes codex table blocks", () => {
    const m: Mutation = { op: "deleteMcp", target: { kind: "codex", filePath: "/c.toml" }, name: "node_repl" };
    const edit = only(planMutation(ctx({ "/c.toml": CODEX_TOML }), m));
    expect(edit.newText).not.toContain("node_repl");
    expect(edit.newText).toContain("# keep me");
  });

  it("throws when the file is missing", () => {
    const m: Mutation = { op: "deleteMcp", target: { kind: "cursor", filePath: "/nope.json" }, name: "x" };
    expect(() => planMutation(ctx({}), m)).toThrow(/not found/);
  });
});

describe("skills", () => {
  const SKILL = "---\nname: keihi\n# comment survives\ndescription: old\nversion: 1.0.0\n---\nold body\n";

  it("creates a new skill with dirs", () => {
    const m: Mutation = { op: "upsertSkill", dir: "/h/.claude/skills", name: "fresh", description: "d", body: "# hi\n" };
    const edit = only(planMutation(ctx({}), m));
    expect(edit.path).toBe("/h/.claude/skills/fresh/SKILL.md");
    expect(edit.createDirs).toEqual(["/h/.claude/skills/fresh"]);
    expect(edit.newText).toContain("name: fresh");
    expect(edit.newText).toContain("# hi");
    expect(edit.newText).not.toContain("version");
  });

  it("updates an existing skill preserving yaml comments", () => {
    const m: Mutation = {
      op: "upsertSkill",
      dir: "/s",
      name: "keihi",
      prevName: "keihi",
      description: "new",
      version: "2.0.0",
      body: "new body\n",
    };
    const edit = only(planMutation(ctx({ "/s/keihi/SKILL.md": SKILL }), m));
    expect(edit.newText).toContain("# comment survives");
    expect(edit.newText).toContain("description: new");
    expect(edit.newText).toContain("version: 2.0.0");
    expect(edit.newText).toContain("new body");
    expect(edit.newText).not.toContain("old body");
  });

  it("renames a skill (new file + delete old dir)", () => {
    const m: Mutation = { op: "upsertSkill", dir: "/s", name: "renamed", prevName: "keihi", description: "d", body: "b\n" };
    const edits = planMutation(ctx({ "/s/keihi/SKILL.md": SKILL }), m);
    expect(edits).toHaveLength(2);
    expect(edits[0]?.path).toBe("/s/renamed/SKILL.md");
    expect(edits[1]).toEqual({ path: "/s/keihi/SKILL.md", newText: null, deleteDirIfEmpty: "/s/keihi" });
  });

  it("clears version when empty", () => {
    const m: Mutation = { op: "upsertSkill", dir: "/s", name: "keihi", prevName: "keihi", description: "d", version: "", body: "b\n" };
    const edit = only(planMutation(ctx({ "/s/keihi/SKILL.md": SKILL }), m));
    expect(edit.newText).not.toContain("version");
  });

  it("rejects invalid skills and deletes cleanly", () => {
    expect(() =>
      planMutation(ctx({}), { op: "upsertSkill", dir: "/s", name: "x", description: "", body: "" }),
    ).toThrow(/description/);
    const del = only(planMutation(ctx({}), { op: "deleteSkill", filePath: "/s/k/SKILL.md", skillDir: "/s/k" }));
    expect(del).toEqual({ path: "/s/k/SKILL.md", newText: null, deleteDirIfEmpty: "/s/k" });
  });
});

describe("subagents / commands", () => {
  it("creates a subagent markdown file", () => {
    const m: Mutation = {
      op: "upsertMarkdown",
      kind: "subagent",
      dir: "/h/.claude/agents",
      name: "reviewer",
      frontmatter: { name: "reviewer", description: "reviews code", tools: "Read, Grep", model: undefined },
      body: "You are a reviewer.\n",
    };
    const edit = only(planMutation(ctx({}), m));
    expect(edit.path).toBe("/h/.claude/agents/reviewer.md");
    expect(edit.createDirs).toEqual(["/h/.claude/agents"]);
    expect(edit.newText).toContain("tools: Read, Grep");
    expect(edit.newText).not.toContain("model");
  });

  it("updates + renames an existing command", () => {
    const existing = "---\ndescription: old\n---\nbody\n";
    const m: Mutation = {
      op: "upsertMarkdown",
      kind: "command",
      dir: "/c",
      name: "ship",
      prevName: "deploy",
      frontmatter: { description: "new" },
      body: "body2\n",
    };
    const edits = planMutation(ctx({ "/c/deploy.md": existing }), m);
    expect(edits).toHaveLength(2);
    expect(edits[0]?.newText).toContain("description: new");
    expect(edits[0]?.newText).toContain("body2");
    expect(edits[1]).toEqual({ path: "/c/deploy.md", newText: null });
  });

  it("creates a command without frontmatter when description empty", () => {
    const m: Mutation = {
      op: "upsertMarkdown",
      kind: "command",
      dir: "/c",
      name: "plain",
      frontmatter: { description: undefined },
      body: "just a prompt\n",
    };
    const edit = only(planMutation(ctx({}), m));
    expect(edit.newText).toBe("just a prompt\n");
  });

  it("rejects bad names and deletes files", () => {
    expect(() =>
      planMutation(ctx({}), { op: "upsertMarkdown", kind: "command", dir: "/c", name: "", frontmatter: {}, body: "" }),
    ).toThrow(/name/);
    expect(only(planMutation(ctx({}), { op: "deleteFile", filePath: "/c/x.md" }))).toEqual({ path: "/c/x.md", newText: null });
  });
});

describe("plugins / settings / raw", () => {
  it("toggles claude plugins via settings.json", () => {
    const m: Mutation = { op: "togglePlugin", agent: "claude", filePath: "/s.json", key: "warp@m", enabled: false };
    const edit = only(planMutation(ctx({ "/s.json": '{\n  "enabledPlugins": {\n    "warp@m": true\n  }\n}\n' }), m));
    expect(parseJsonText(edit.newText)).toEqual({ enabledPlugins: { "warp@m": false } });
  });

  it("toggles codex plugins via config.toml", () => {
    const m: Mutation = { op: "togglePlugin", agent: "codex", filePath: "/c.toml", key: "browser@openai-bundled", enabled: false };
    const edit = only(planMutation(ctx({ "/c.toml": CODEX_TOML }), m));
    expect(edit.newText).toContain("enabled = false");
    expect(edit.newText).toContain("# keep me");
  });

  it("sets json settings at nested paths", () => {
    const m: Mutation = { op: "setSetting", filePath: "/s.json", format: "json", keyPath: ["permissions", "defaultMode"], value: "plan" };
    const edit = only(planMutation(ctx({ "/s.json": "{}" }), m));
    expect(parseJsonText(edit.newText)).toEqual({ permissions: { defaultMode: "plan" } });
  });

  it("sets toml top-level settings, rejecting nested paths", () => {
    const m: Mutation = { op: "setSetting", filePath: "/c.toml", format: "toml", keyPath: ["model"], value: "gpt-6" };
    const edit = only(planMutation(ctx({ "/c.toml": CODEX_TOML }), m));
    expect(edit.newText).toContain('model = "gpt-6"');
    expect(() =>
      planMutation(ctx({ "/c.toml": CODEX_TOML }), { op: "setSetting", filePath: "/c.toml", format: "toml", keyPath: ["a", "b"], value: 1 }),
    ).toThrow(/top-level/);
    const created = only(planMutation(ctx({}), { op: "setSetting", filePath: "/new.toml", format: "toml", keyPath: ["model"], value: "m" }));
    expect(created.newText).toBe('model = "m"\n');
  });

  it("validates raw writes per format", () => {
    expect(only(planMutation(ctx({}), { op: "writeRaw", filePath: "/f.json", format: "json", newText: '{"a":1}' })).newText).toBe('{"a":1}');
    expect(() => planMutation(ctx({}), { op: "writeRaw", filePath: "/f.json", format: "json", newText: "{oops" })).toThrow(/JSON/);
    expect(() => planMutation(ctx({}), { op: "writeRaw", filePath: "/f.toml", format: "toml", newText: "[broken" })).toThrow();
    expect(only(planMutation(ctx({}), { op: "writeRaw", filePath: "/f.md", format: "markdown", newText: "# any" })).newText).toBe("# any");
  });
});

describe("mutationReadPaths", () => {
  it("returns the files each op consults", () => {
    expect(mutationReadPaths({ op: "upsertMcp", target: { kind: "codex", filePath: "/c" }, input: { name: "a", transport: "stdio", command: "x" } })).toEqual(["/c"]);
    expect(mutationReadPaths({ op: "deleteMcp", target: { kind: "cursor", filePath: "/m" }, name: "a" })).toEqual(["/m"]);
    expect(mutationReadPaths({ op: "upsertSkill", dir: "/d", name: "n", prevName: "o", description: "d", body: "" })).toEqual([
      "/d/o/SKILL.md",
      "/d/n/SKILL.md",
    ]);
    expect(mutationReadPaths({ op: "upsertSkill", dir: "/d", name: "n", description: "d", body: "" })).toEqual([
      "/d/n/SKILL.md",
      "/d/n/SKILL.md",
    ]);
    expect(mutationReadPaths({ op: "deleteSkill", filePath: "/f", skillDir: "/d" })).toEqual(["/f"]);
    expect(mutationReadPaths({ op: "upsertMarkdown", kind: "command", dir: "/d", name: "n", frontmatter: {}, body: "" })).toEqual([
      "/d/n.md",
      "/d/n.md",
    ]);
    expect(mutationReadPaths({ op: "deleteFile", filePath: "/f" })).toEqual(["/f"]);
    expect(mutationReadPaths({ op: "togglePlugin", agent: "claude", filePath: "/s", key: "k", enabled: true })).toEqual(["/s"]);
    expect(mutationReadPaths({ op: "setSetting", filePath: "/s", format: "json", keyPath: ["a"], value: 1 })).toEqual(["/s"]);
    expect(mutationReadPaths({ op: "writeRaw", filePath: "/s", format: "markdown", newText: "" })).toEqual(["/s"]);
  });
});
