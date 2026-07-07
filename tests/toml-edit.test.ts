import { describe, expect, it } from "vitest";
import {
  assertValidToml,
  removeKeyInTable,
  removeTables,
  setKeyInTable,
  setTopLevelKey,
  tomlHeader,
  tomlKey,
  tomlString,
  tomlValue,
  upsertTableBlock,
} from "../src/lib/toml/toml-edit";

// commented config.toml fixture matching the real codex shape
const CONFIG = `# codex configuration — DO NOT LOSE THIS COMMENT
model = "gpt-5.2"
model_reasoning_effort = "high"  # inline comment

[projects."/Users/x/src"]
trust_level = "trusted"

# mcp servers below
[mcp_servers.node_repl]
command = "node"
args = ["repl.js"]
startup_timeout_sec = 30

[mcp_servers.node_repl.env]
NODE_REPL_TOKEN = "secret-abc"

[plugins."browser@openai-bundled"]
enabled = true

[features]
js_repl = true
`;

describe("toml value serialization", () => {
  it("serializes strings with escapes", () => {
    expect(tomlString("plain")).toBe('"plain"');
    expect(tomlString('say "hi"\\')).toBe('"say \\"hi\\"\\\\"');
    expect(tomlString("a\nb\tc\rd")).toBe('"a\\nb\\tc\\rd"');
    expect(tomlString("bell")).toBe('"bell\\u0007"');
  });

  it("serializes primitives, arrays and objects", () => {
    expect(tomlValue(42)).toBe("42");
    expect(tomlValue(true)).toBe("true");
    expect(tomlValue(["a", 1])).toBe('["a", 1]');
    expect(tomlValue({ k: "v", n: 2 })).toBe('{ k = "v", n = 2 }');
  });

  it("throws on unserializable values", () => {
    expect(() => tomlValue(null)).toThrow(/cannot serialize/);
    expect(() => tomlValue(undefined)).toThrow(/cannot serialize/);
  });

  it("quotes non-bare keys", () => {
    expect(tomlKey("simple_key")).toBe("simple_key");
    expect(tomlKey("name@market")).toBe('"name@market"');
    expect(tomlHeader(["mcp_servers", "my srv"])).toBe('[mcp_servers."my srv"]');
  });
});

describe("removeTables", () => {
  it("removes a table and its subtables, preserving everything else", () => {
    const out = removeTables(CONFIG, ["mcp_servers", "node_repl"]);
    expect(out).not.toContain("[mcp_servers.node_repl]");
    expect(out).not.toContain("NODE_REPL_TOKEN");
    expect(out).toContain("# codex configuration — DO NOT LOSE THIS COMMENT");
    expect(out).toContain('[plugins."browser@openai-bundled"]');
    expect(out).toContain("[features]");
    assertValidToml(out);
  });

  it("is a no-op when the table does not exist", () => {
    expect(removeTables(CONFIG, ["mcp_servers", "nope"])).toBe(CONFIG);
  });

  it("handles a table at EOF", () => {
    const out = removeTables(CONFIG, ["features"]);
    expect(out).not.toContain("js_repl");
    assertValidToml(out);
  });
});

describe("upsertTableBlock", () => {
  it("replaces an existing server block", () => {
    const block = `[mcp_servers.node_repl]\ncommand = "deno"\n`;
    const out = upsertTableBlock(CONFIG, ["mcp_servers", "node_repl"], block);
    expect(out).toContain('command = "deno"');
    expect(out).not.toContain("repl.js");
    expect(out).toContain("# codex configuration — DO NOT LOSE THIS COMMENT");
    expect(out).toContain("model_reasoning_effort");
    assertValidToml(out);
  });

  it("appends a new server block", () => {
    const block = `[mcp_servers.newsrv]\ncommand = "npx"\n`;
    const out = upsertTableBlock(CONFIG, ["mcp_servers", "newsrv"], block);
    expect(out).toContain("[mcp_servers.newsrv]");
    expect(out).toContain("[mcp_servers.node_repl]"); // untouched
    expect(out.endsWith('command = "npx"\n')).toBe(true);
    assertValidToml(out);
  });

  it("works on an empty file", () => {
    const out = upsertTableBlock("", ["mcp_servers", "a"], `[mcp_servers.a]\ncommand = "x"\n`);
    expect(out).toBe(`[mcp_servers.a]\ncommand = "x"\n`);
    assertValidToml(out);
  });

  it("works on text without trailing newline", () => {
    const out = upsertTableBlock('model = "m"', ["mcp_servers", "a"], "[mcp_servers.a]\ncommand = \"x\"");
    expect(out).toBe('model = "m"\n\n[mcp_servers.a]\ncommand = "x"\n');
  });
});

describe("setKeyInTable", () => {
  it("replaces an existing value, preserving inline comments elsewhere", () => {
    const out = setKeyInTable(CONFIG, ["plugins", "browser@openai-bundled"], "enabled", false);
    expect(out).toContain("enabled = false");
    expect(out).toContain("# inline comment");
    assertValidToml(out);
  });

  it("inserts a new key into an existing table", () => {
    const out = setKeyInTable(CONFIG, ["features"], "new_flag", true);
    expect(out).toContain("js_repl = true\nnew_flag = true");
    assertValidToml(out);
  });

  it("creates the table when missing", () => {
    const out = setKeyInTable(CONFIG, ["plugins", "other@market"], "enabled", true);
    expect(out).toContain('[plugins."other@market"]\nenabled = true');
    assertValidToml(out);
  });
});

describe("setTopLevelKey", () => {
  it("replaces an existing top-level value", () => {
    const out = setTopLevelKey(CONFIG, "model", "gpt-6");
    expect(out).toContain('model = "gpt-6"');
    expect(out).toContain("# codex configuration");
    assertValidToml(out);
  });

  it("inserts a new key before the first table", () => {
    const out = setTopLevelKey(CONFIG, "notify", ["say"]);
    const notifyPos = out.indexOf("notify = ");
    const firstTablePos = out.indexOf("[projects.");
    expect(notifyPos).toBeGreaterThan(-1);
    expect(notifyPos).toBeLessThan(firstTablePos);
    assertValidToml(out);
  });

  it("appends when there are no tables", () => {
    const out = setTopLevelKey('a = 1\n', "b", 2);
    expect(out).toBe("a = 1\n\nb = 2\n");
    assertValidToml(out);
  });
});

describe("removeKeyInTable", () => {
  it("removes an existing key line", () => {
    const out = removeKeyInTable(CONFIG, ["mcp_servers", "node_repl"], "startup_timeout_sec");
    expect(out).not.toContain("startup_timeout_sec");
    expect(out).toContain('args = ["repl.js"]');
    assertValidToml(out);
  });

  it("is a no-op for missing table or key", () => {
    expect(removeKeyInTable(CONFIG, ["nope"], "k")).toBe(CONFIG);
    expect(removeKeyInTable(CONFIG, ["features"], "nope")).toBe(CONFIG);
  });
});

describe("assertValidToml", () => {
  it("throws on invalid TOML", () => {
    expect(() => assertValidToml("[broken\nx =")).toThrow();
  });
});
