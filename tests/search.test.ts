import { describe, expect, it } from "vitest";
import { entityLabel, entitySublabel, fuzzyScore, searchItems, type SearchItem } from "../src/lib/search";
import type {
  CommandEntity,
  InstructionsEntity,
  McpServerEntity,
  PluginEntity,
  SettingsEntity,
  SkillEntity,
  SubagentEntity,
} from "../src/lib/model/types";

const USER = { level: "user" } as const;

describe("fuzzyScore", () => {
  it("returns null for empty query", () => {
    expect(fuzzyScore("", "anything")).toBeNull();
  });

  it("returns null when a character does not match", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("KEI", "keihi")).not.toBeNull();
    expect(fuzzyScore("kei", "KEIHI")).not.toBeNull();
  });

  it("matches non-contiguous subsequences", () => {
    expect(fuzzyScore("kh", "keihi")).not.toBeNull();
  });

  it("ranks a literal substring above a scattered word-boundary match", () => {
    const literal = fuzzyScore("mcp", "mcp-server") as number;
    const scattered = fuzzyScore("mcp", "my-cool-plugin") as number;
    expect(literal).toBeGreaterThan(scattered);
  });

  it("ranks a prefix match above a mid-string match", () => {
    const prefix = fuzzyScore("ab", "abc") as number;
    const midString = fuzzyScore("ab", "xab") as number;
    expect(prefix).toBeGreaterThan(midString);
  });

  it("gives a word-boundary bonus for a match right after a separator", () => {
    const afterDash = fuzzyScore("s", "my-skill") as number;
    const midWord = fuzzyScore("s", "myskill") as number;
    expect(afterDash).toBeGreaterThan(midWord);
  });
});

describe("searchItems", () => {
  const items: SearchItem[] = [
    { id: "1", label: "keihi", sublabel: "経費整理" },
    { id: "2", label: "publish-check" },
    { id: "3", label: "unrelated", sublabel: "keihi mentioned here" },
    { id: "4", label: "no-match-at-all" },
  ];

  it("returns an empty array for an empty or whitespace-only query", () => {
    expect(searchItems("", items)).toEqual([]);
    expect(searchItems("   ", items)).toEqual([]);
  });

  it("matches on label first", () => {
    const hits = searchItems("keihi", items);
    expect(hits[0]?.item.id).toBe("1");
  });

  it("falls back to sublabel and ranks it below label matches", () => {
    const hits = searchItems("keihi", items);
    const ids = hits.map((h) => h.item.id);
    expect(ids).toContain("3");
    const labelHit = hits.find((h) => h.item.id === "1");
    const sublabelHit = hits.find((h) => h.item.id === "3");
    expect(labelHit && sublabelHit && labelHit.score > sublabelHit.score).toBe(true);
  });

  it("excludes items with no match in label or sublabel", () => {
    const hits = searchItems("keihi", items);
    expect(hits.some((h) => h.item.id === "4")).toBe(false);
    expect(hits.some((h) => h.item.id === "2")).toBe(false);
  });

  it("respects the limit", () => {
    const many: SearchItem[] = Array.from({ length: 30 }, (_, i) => ({ id: String(i), label: `item-${i}` }));
    expect(searchItems("item", many, 5)).toHaveLength(5);
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchItems("zzzzz", items)).toEqual([]);
  });

  it("ignores items without a sublabel when label does not match", () => {
    const hits = searchItems("publish", items);
    expect(hits.map((h) => h.item.id)).toEqual(["2"]);
  });
});

describe("entityLabel / entitySublabel", () => {
  const base = { id: "x", agent: "claude" as const, scope: USER, filePath: "/f", readOnly: false };

  it("mcp: label=name, sublabel=command or url", () => {
    const stdio: McpServerEntity = {
      ...base,
      kind: "mcp",
      name: "keyway",
      source: { kind: "claude-user" },
      transport: "stdio",
      command: "npx",
      extras: {},
    };
    expect(entityLabel(stdio)).toBe("keyway");
    expect(entitySublabel(stdio)).toBe("npx");

    const remote: McpServerEntity = { ...stdio, transport: "http", command: undefined, url: "https://x" };
    expect(entitySublabel(remote)).toBe("https://x");

    const bare: McpServerEntity = { ...stdio, command: undefined, url: undefined };
    expect(entitySublabel(bare)).toBeUndefined();
  });

  it("skill/subagent/command: label=name, sublabel=description", () => {
    const skill: SkillEntity = { ...base, kind: "skill", name: "keihi", description: "経費", frontmatterExtras: {}, body: "" };
    expect(entityLabel(skill)).toBe("keihi");
    expect(entitySublabel(skill)).toBe("経費");

    const sub: SubagentEntity = { ...base, kind: "subagent", name: "reviewer", description: "reviews", frontmatterExtras: {}, body: "" };
    expect(entityLabel(sub)).toBe("reviewer");
    expect(entitySublabel(sub)).toBe("reviews");

    const cmd: CommandEntity = { ...base, kind: "command", name: "deploy", description: undefined, frontmatterExtras: {}, body: "" };
    expect(entityLabel(cmd)).toBe("deploy");
    expect(entitySublabel(cmd)).toBeUndefined();
  });

  it("plugin: label=key, sublabel=marketplace (or undefined when empty)", () => {
    const plugin: PluginEntity = { ...base, kind: "plugin", key: "warp@marketplace", marketplace: "marketplace", enabled: true };
    expect(entityLabel(plugin)).toBe("warp@marketplace");
    expect(entitySublabel(plugin)).toBe("marketplace");

    const noMarket: PluginEntity = { ...plugin, marketplace: "" };
    expect(entitySublabel(noMarket)).toBeUndefined();
  });

  it("settings/instructions: label=name, sublabel=filePath", () => {
    const settings: SettingsEntity = { ...base, kind: "settings", name: "settings.json", format: "json", rawText: "{}", known: {} };
    expect(entityLabel(settings)).toBe("settings.json");
    expect(entitySublabel(settings)).toBe("/f");

    const instructions: InstructionsEntity = { ...base, kind: "instructions", name: "AGENTS.md", body: "" };
    expect(entityLabel(instructions)).toBe("AGENTS.md");
    expect(entitySublabel(instructions)).toBe("/f");
  });
});
