import { describe, expect, it } from "vitest";
import { buildDiffLines, maskDiff } from "../src/lib/diff";
import { MASK, looksLikeSecret, maskValues } from "../src/lib/redact";
import { validateEntityName, validateMcpInput, validateSkillInput } from "../src/lib/validate";

describe("buildDiffLines", () => {
  it("reports adds and dels with context", () => {
    const oldText = "a\nb\nc\nd\ne\n";
    const newText = "a\nb\nX\nd\ne\n";
    const lines = buildDiffLines(oldText, newText);
    expect(lines).toEqual([
      { type: "ctx", text: "a" },
      { type: "ctx", text: "b" },
      { type: "del", text: "c" },
      { type: "add", text: "X" },
      { type: "ctx", text: "d" },
      { type: "ctx", text: "e" },
    ]);
  });

  it("collapses long unchanged runs", () => {
    const body = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
    const oldText = `start\n${body}\nend\n`;
    const newText = `START\n${body}\nend\n`;
    const lines = buildDiffLines(oldText, newText);
    const skip = lines.find((l) => l.type === "skip");
    expect(skip?.text).toMatch(/unchanged lines/);
    expect(lines.filter((l) => l.type === "ctx").length).toBeLessThanOrEqual(6);
  });

  it("handles file creation and deletion", () => {
    expect(buildDiffLines(null, "new\n")).toEqual([{ type: "add", text: "new" }]);
    expect(buildDiffLines("old\n", null)).toEqual([{ type: "del", text: "old" }]);
  });

  it("collapses an all-context diff to a single skip", () => {
    const body = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const lines = buildDiffLines(body, body);
    expect(lines).toEqual([{ type: "skip", text: "… 20 unchanged lines" }]);
  });
});

describe("maskDiff", () => {
  it("masks secret values in diff lines", () => {
    const lines = buildDiffLines('TOKEN = "old-secret-1"\n', 'TOKEN = "new-secret-2"\n');
    const masked = maskDiff(lines, ["old-secret-1", "new-secret-2"]);
    expect(masked.every((l) => !l.text.includes("secret-1") && !l.text.includes("secret-2"))).toBe(true);
    expect(masked.some((l) => l.text.includes(MASK))).toBe(true);
  });

  it("returns lines unchanged when no secrets", () => {
    const lines = buildDiffLines("a\n", "b\n");
    expect(maskDiff(lines, [])).toBe(lines);
  });
});

describe("redact", () => {
  it("flags secret-looking keys and values", () => {
    expect(looksLikeSecret("API_KEY", "x")).toBe(true);
    expect(looksLikeSecret("password", "x")).toBe(true);
    expect(looksLikeSecret("name", "sk-abc123")).toBe(true);
    expect(looksLikeSecret("name", "ghp_abc")).toBe(true);
    expect(looksLikeSecret("name", "A".repeat(41))).toBe(true);
    expect(looksLikeSecret("name", "hello world")).toBe(false);
  });

  it("maskValues replaces longest-first and skips short values", () => {
    expect(maskValues("ab secret secret-long", ["secret", "secret-long", "ab"])).toBe(`ab ${MASK} ${MASK}`);
    expect(maskValues("regex .*+ chars", [".*+ chars"])).toBe(`regex ${MASK}`);
  });
});

describe("validate", () => {
  it("validateEntityName", () => {
    expect(validateEntityName("good-name_1.x")).toEqual([]);
    expect(validateEntityName(" ")).toEqual(["name is required"]);
    expect(validateEntityName("bad name")).toHaveLength(1);
    expect(validateEntityName("-leading")).toHaveLength(1);
  });

  it("validateMcpInput stdio", () => {
    expect(validateMcpInput({ name: "a", transport: "stdio", command: "npx" })).toEqual([]);
    expect(validateMcpInput({ name: "a", transport: "stdio", command: " " })).toHaveLength(1);
    expect(validateMcpInput({ name: "a", transport: "stdio" })).toHaveLength(1);
  });

  it("validateMcpInput remote", () => {
    expect(validateMcpInput({ name: "a", transport: "http", url: "https://x.dev" })).toEqual([]);
    expect(validateMcpInput({ name: "a", transport: "http", url: "ftp://x" })).toHaveLength(1);
    expect(validateMcpInput({ name: "a", transport: "sse" })).toHaveLength(1);
  });

  it("validateMcpInput env/headers/timeout", () => {
    expect(validateMcpInput({ name: "a", transport: "stdio", command: "c", env: { "B=D": "x" } })).toHaveLength(1);
    expect(validateMcpInput({ name: "a", transport: "stdio", command: "c", env: { " ": "x" } })).toHaveLength(1);
    expect(validateMcpInput({ name: "a", transport: "http", url: "https://x", headers: { "": "v" } })).toHaveLength(1);
    expect(validateMcpInput({ name: "a", transport: "stdio", command: "c", startupTimeoutSec: 0 })).toHaveLength(1);
    expect(validateMcpInput({ name: "a", transport: "stdio", command: "c", startupTimeoutSec: 5 })).toEqual([]);
  });

  it("validateSkillInput", () => {
    expect(validateSkillInput("skill", "desc")).toEqual([]);
    expect(validateSkillInput("skill", " ")).toEqual(["description is required"]);
    expect(validateSkillInput("", "")).toHaveLength(2);
  });
});
