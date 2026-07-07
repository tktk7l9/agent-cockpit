import { describe, expect, it } from "vitest";
import {
  claudeEnabledPlugins,
  claudeSettingsKnown,
  parseClaudeGlobal,
  parseInstalledPlugins,
  parseMcpJsonFile,
} from "../src/lib/agents/claude";
import { parseCodexConfig } from "../src/lib/agents/codex";

describe("parseClaudeGlobal", () => {
  it("extracts mcpServers and per-project config", () => {
    const g = parseClaudeGlobal(
      JSON.stringify({
        mcpServers: { keyway: { type: "stdio", command: "npx" }, bad: "not-an-object" },
        projects: {
          "/p1": { mcpServers: { mdn: { url: "https://x" } }, enabledMcpjsonServers: ["a"], disabledMcpjsonServers: ["b"] },
          "/p2": "garbage",
        },
        otherKey: 1,
      }),
    );
    expect(Object.keys(g.mcpServers)).toEqual(["keyway"]);
    expect(g.projects["/p1"]?.mcpServers["mdn"]).toEqual({ url: "https://x" });
    expect(g.projects["/p1"]?.enabledMcpjsonServers).toEqual(["a"]);
    expect(g.projects["/p1"]?.disabledMcpjsonServers).toEqual(["b"]);
    expect(g.projects["/p2"]).toEqual({ mcpServers: {}, enabledMcpjsonServers: [], disabledMcpjsonServers: [] });
  });

  it("tolerates null/empty/keyless input", () => {
    expect(parseClaudeGlobal(null)).toEqual({ mcpServers: {}, projects: {} });
    expect(parseClaudeGlobal("{}")).toEqual({ mcpServers: {}, projects: {} });
    expect(parseClaudeGlobal("[1]")).toEqual({ mcpServers: {}, projects: {} });
  });
});

describe("parseMcpJsonFile", () => {
  it("reads servers and tolerates empty files", () => {
    expect(parseMcpJsonFile('{"mcpServers": {"supabase": {"type": "http", "url": "https://x"}}}')).toEqual({
      supabase: { type: "http", url: "https://x" },
    });
    expect(parseMcpJsonFile("")).toEqual({});
    expect(parseMcpJsonFile(null)).toEqual({});
  });
});

describe("claudeSettingsKnown", () => {
  it("extracts known keys when present", () => {
    expect(
      claudeSettingsKnown(JSON.stringify({ model: "opus", effortLevel: "high", permissions: { defaultMode: "plan" }, tui: {} })),
    ).toEqual({ model: "opus", effortLevel: "high", "permissions.defaultMode": "plan" });
  });

  it("skips absent keys and malformed permissions", () => {
    expect(claudeSettingsKnown("{}")).toEqual({});
    expect(claudeSettingsKnown(JSON.stringify({ permissions: "x" }))).toEqual({});
    expect(claudeSettingsKnown(JSON.stringify({ permissions: {} }))).toEqual({});
  });
});

describe("claudeEnabledPlugins", () => {
  it("maps values to booleans", () => {
    expect(claudeEnabledPlugins(JSON.stringify({ enabledPlugins: { "a@m": true, "b@m": false, "c@m": "yes" } }))).toEqual({
      "a@m": true,
      "b@m": false,
      "c@m": false,
    });
    expect(claudeEnabledPlugins("{}")).toEqual({});
  });
});

describe("parseInstalledPlugins", () => {
  it("reads v2 array entries", () => {
    const out = parseInstalledPlugins(
      JSON.stringify({
        version: 2,
        plugins: {
          "warp@claude-code-warp": [{ scope: "user", installPath: "/x", version: "1.0.0" }],
          "obj@m": { version: "2.0.0" },
          "empty@m": [],
        },
      }),
    );
    expect(out["warp@claude-code-warp"]).toEqual({ version: "1.0.0", installPath: "/x" });
    expect(out["obj@m"]).toEqual({ version: "2.0.0", installPath: undefined });
    expect(out["empty@m"]).toEqual({ version: undefined, installPath: undefined });
  });

  it("tolerates missing plugins key", () => {
    expect(parseInstalledPlugins("{}")).toEqual({});
  });
});

describe("parseCodexConfig", () => {
  const TOML = `
model = "gpt-5.2"
model_reasoning_effort = "high"
notify = ["say"]

[projects."/Users/x/src"]
trust_level = "trusted"

[projects."/Users/x/other"]
foo = 1

[mcp_servers.node_repl]
command = "node"
args = ["repl.js"]
startup_timeout_sec = 30

[mcp_servers.node_repl.env]
TOKEN = "abc"

[plugins."browser@openai-bundled"]
enabled = true

[plugins."pdf@openai-bundled"]
enabled = false
`;

  it("extracts servers, plugins, projects and known keys", () => {
    const c = parseCodexConfig(TOML);
    expect(c.mcpServers["node_repl"]?.["command"]).toBe("node");
    expect((c.mcpServers["node_repl"]?.["env"] as Record<string, unknown>)["TOKEN"]).toBe("abc");
    expect(c.plugins).toEqual({ "browser@openai-bundled": true, "pdf@openai-bundled": false });
    expect(c.projects["/Users/x/src"]).toEqual({ trustLevel: "trusted" });
    expect(c.projects["/Users/x/other"]).toEqual({ trustLevel: undefined });
    expect(c.known).toEqual({ model: "gpt-5.2", model_reasoning_effort: "high" });
  });

  it("tolerates null/empty/minimal input", () => {
    const empty = { mcpServers: {}, plugins: {}, projects: {}, known: {} };
    expect(parseCodexConfig(null)).toEqual(empty);
    expect(parseCodexConfig("  ")).toEqual(empty);
    expect(parseCodexConfig("other = 1")).toEqual(empty);
  });
});
