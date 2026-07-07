import { describe, expect, it } from "vitest";
import { isJsonParseable, parseJsonText, removeJsonKey, setJsonValue } from "../src/lib/json/jsonc-edit";

// a ~/.claude.json-shaped file with decoy keys that must never change
const DECOYS = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`decoyKey${i}`, { nested: i, list: [i] }]));
const CLAUDE_JSON = JSON.stringify(
  {
    numStartups: 42,
    ...DECOYS,
    mcpServers: { keyway: { type: "stdio", command: "npx", args: ["-y", "keyway"], env: { TOKEN: "secret-value-123" } } },
    projects: { "/Users/x/proj": { allowedTools: [], mcpServers: {}, hasTrustDialogAccepted: true } },
    userID: "abc",
  },
  null,
  2,
);

describe("parseJsonText", () => {
  it("parses valid JSON", () => {
    expect(parseJsonText('{"a": 1}')).toEqual({ a: 1 });
  });

  it("returns {} for null and empty", () => {
    expect(parseJsonText(null)).toEqual({});
    expect(parseJsonText("  ")).toEqual({});
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonText("{oops")).toThrow(/invalid JSON/);
  });
});

describe("setJsonValue", () => {
  it("touches only the target subtree of a large file", () => {
    const out = setJsonValue(CLAUDE_JSON, ["mcpServers", "newsrv"], { type: "http", url: "https://x" });
    const parsed = parseJsonText(out) as Record<string, unknown>;
    expect((parsed["mcpServers"] as Record<string, unknown>)["newsrv"]).toEqual({ type: "http", url: "https://x" });
    // every other line is byte-identical
    const oldLines = CLAUDE_JSON.split("\n");
    const newLines = out.split("\n");
    const removed = oldLines.filter((l) => !newLines.includes(l));
    expect(removed.length).toBeLessThanOrEqual(1); // only the closing brace line of mcpServers changes
    expect(out).toContain('"decoyKey59"');
    expect(out).toContain('"numStartups": 42');
  });

  it("creates missing parents", () => {
    const out = setJsonValue(CLAUDE_JSON, ["projects", "/Users/x/proj", "mcpServers", "srv"], { type: "stdio", command: "x" });
    const parsed = parseJsonText(out) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed["projects"]?.["/Users/x/proj"]?.["mcpServers"]).toEqual({ srv: { type: "stdio", command: "x" } });
  });

  it("starts from {} for absent files", () => {
    const out = setJsonValue(null, ["mcpServers", "a"], { type: "stdio", command: "c" });
    expect(parseJsonText(out)).toEqual({ mcpServers: { a: { type: "stdio", command: "c" } } });
  });

  it("starts from {} for empty files (0-byte cursor mcp.json)", () => {
    const out = setJsonValue("", ["mcpServers", "a"], { type: "stdio", command: "c" });
    expect(parseJsonText(out)).toEqual({ mcpServers: { a: { type: "stdio", command: "c" } } });
  });

  it("refuses to edit unparseable files", () => {
    expect(() => setJsonValue("{broken", ["a"], 1)).toThrow(/invalid JSON/);
  });
});

describe("removeJsonKey", () => {
  it("removes a key", () => {
    const out = removeJsonKey(CLAUDE_JSON, ["mcpServers", "keyway"]);
    const parsed = parseJsonText(out) as Record<string, unknown>;
    expect(parsed["mcpServers"]).toEqual({});
    expect(parsed["userID"]).toBe("abc");
  });

  it("is a no-op for missing keys", () => {
    const out = removeJsonKey(CLAUDE_JSON, ["mcpServers", "nope"]);
    expect(parseJsonText(out)).toEqual(parseJsonText(CLAUDE_JSON));
  });

  it("handles null/empty input", () => {
    expect(parseJsonText(removeJsonKey(null, ["a"]))).toEqual({});
    expect(() => removeJsonKey("{bad", ["a"])).toThrow(/invalid JSON/);
  });
});

describe("isJsonParseable", () => {
  it("accepts valid and rejects invalid", () => {
    expect(isJsonParseable('{"a": 1}')).toBe(true);
    expect(isJsonParseable("{nope")).toBe(false);
  });
});
