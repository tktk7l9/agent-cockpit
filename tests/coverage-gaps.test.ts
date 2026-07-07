// Edge cases that close the last coverage branches — each one documents a real
// scenario the app can encounter.

import { describe, expect, it } from "vitest";
import {
  claudeEnabledPlugins,
  claudeSettingsKnown,
  parseInstalledPlugins,
  parseMcpJsonFile,
} from "../src/lib/agents/claude";
import { parseCodexConfig } from "../src/lib/agents/codex";
import { errorMessage } from "../src/lib/errors";
import { buildInventory } from "../src/lib/inventory";
import type { PluginEntity, SettingsEntity, SubagentEntity, TaggedSnapshot } from "../src/lib/model/types";
import { planMutation, type Mutation } from "../src/lib/mutations";
import { removeKeyInTable, removeTables, upsertTableBlock } from "../src/lib/toml/toml-edit";

const USER = { level: "user" } as const;
const PROJ = { level: "project", projectPath: "/proj" } as const;

describe("errorMessage", () => {
  it("unwraps Errors and stringifies the rest", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});

describe("claude parsers with non-object roots", () => {
  it("tolerate arrays at the top level", () => {
    expect(parseMcpJsonFile("[1]")).toEqual({});
    expect(claudeSettingsKnown("[1]")).toEqual({});
    expect(claudeEnabledPlugins("[1]")).toEqual({});
    expect(parseInstalledPlugins("[1]")).toEqual({});
  });
});

describe("codex config edge cases", () => {
  it("skips non-table entries under [mcp_servers]", () => {
    const c = parseCodexConfig("[mcp_servers]\nbogus = 1\n\n[mcp_servers.real]\ncommand = \"x\"\n");
    expect(Object.keys(c.mcpServers)).toEqual(["real"]);
  });
});

describe("toml-edit edge cases", () => {
  it("removes a table that starts at offset 0", () => {
    expect(removeTables('[t]\na = 1\n\n[u]\nb = 2\n', ["t"])).toBe("[u]\nb = 2\n");
  });

  it("handles CRLF line endings and missing trailing newline", () => {
    expect(removeTables("[t]\r\na = 1\r\n\r\n[u]\r\nb = 2\r\n", ["t"])).toBe("[u]\r\nb = 2\r\n");
    // the blank separator line before the removed trailing table remains — harmless
    expect(removeTables("[u]\nb = 2\n\n[t]\na = 1", ["t"])).toBe("[u]\nb = 2\n\n");
  });

  it("matches quoted keys inside tables", () => {
    const src = '[env]\n"MY.TOKEN" = "x"\nPLAIN = "y"\n';
    const out = removeKeyInTable(src, ["env"], "MY.TOKEN");
    expect(out).toBe('[env]\nPLAIN = "y"\n');
  });

  it("appends a block without trailing newline to an empty file", () => {
    expect(upsertTableBlock("", ["a"], "[a]\nx = 1")).toBe("[a]\nx = 1\n");
  });
});

describe("inventory edge cases", () => {
  it("handles a completely empty snapshot set", () => {
    expect(buildInventory([], [])).toEqual({ entities: [], errors: [], projects: [] });
  });

  it("handles plugin keys without a marketplace and missing installed_plugins.json", () => {
    const snaps: TaggedSnapshot[] = [
      {
        tag: { t: "claudeSettings", scope: USER, local: false },
        path: "/s.json",
        text: JSON.stringify({ enabledPlugins: { noat: true } }),
      },
      { tag: { t: "codexConfig" }, path: "/c.toml", text: "[plugins.noat]\nenabled = true\n" },
    ];
    const plugins = buildInventory(snaps, []).entities.filter((e) => e.kind === "plugin") as PluginEntity[];
    expect(plugins).toHaveLength(2);
    expect(plugins.every((p) => p.marketplace === "")).toBe(true);
  });

  it("emits local/project settings entities and ungated cursor servers", () => {
    const snaps: TaggedSnapshot[] = [
      {
        tag: { t: "claudeSettings", scope: PROJ, local: true },
        path: "/proj/.claude/settings.local.json",
        text: JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }),
      },
      {
        tag: { t: "mcpJson", agent: "cursor", scope: USER },
        path: "/h/.cursor/mcp.json",
        text: JSON.stringify({ mcpServers: { figma: { url: "https://f" } } }),
      },
    ];
    const inv = buildInventory(snaps, []);
    const settings = inv.entities.find((e) => e.kind === "settings") as SettingsEntity;
    expect(settings.name).toBe("settings.local.json");
    expect(settings.scope).toEqual(PROJ);
    const mcp = inv.entities.find((e) => e.kind === "mcp");
    expect(mcp && "enabled" in mcp ? mcp.enabled : "x").toBeUndefined();
    expect(mcp && "source" in mcp ? mcp.source : null).toEqual({ kind: "cursor" });
  });

  it("falls back to file names for subagents without frontmatter", () => {
    const snaps: TaggedSnapshot[] = [
      { tag: { t: "subagent", agent: "cursor", scope: USER, name: "bare" }, path: "/a/bare.md", text: "prompt only\n" },
    ];
    const sub = buildInventory(snaps, []).entities[0] as SubagentEntity;
    expect(sub.name).toBe("bare");
    expect(sub.description).toBe("");
  });

  it("dedupes duplicate manual project registrations", () => {
    const inv = buildInventory([], ["/dup", "/dup"]);
    expect(inv.projects).toEqual([{ path: "/dup", sources: ["manual"], codexTrustLevel: undefined }]);
  });
});

describe("mutation edge cases", () => {
  it("creates ~/.codex/config.toml from scratch for a first server without args", () => {
    const m: Mutation = {
      op: "upsertMcp",
      target: { kind: "codex", filePath: "/h/.codex/config.toml" },
      input: { name: "solo", transport: "stdio", command: "solo-cmd" },
    };
    const edit = planMutation({ snapshot: () => null }, m)[0];
    expect(edit?.newText).toBe('[mcp_servers.solo]\ncommand = "solo-cmd"\n');
  });

  it("collects old secrets when deleting from an existing cursor mcp.json", () => {
    const existing = JSON.stringify({ mcpServers: { s: { command: "x", env: { KEY: "cursor-secret-7" } } } });
    const m: Mutation = { op: "deleteMcp", target: { kind: "cursor", filePath: "/m.json" }, name: "s" };
    const edit = planMutation({ snapshot: () => existing }, m)[0];
    expect(edit?.secretValues).toContain("cursor-secret-7");
  });

  it("normalizes a command body without trailing newline", () => {
    const m: Mutation = {
      op: "upsertMarkdown",
      kind: "command",
      dir: "/c",
      name: "n",
      frontmatter: {},
      body: "no newline",
    };
    expect(planMutation({ snapshot: () => null }, m)[0]?.newText).toBe("no newline\n");
  });

  it("toggles a codex plugin even when config.toml is missing", () => {
    const m: Mutation = { op: "togglePlugin", agent: "codex", filePath: "/c.toml", key: "a@m", enabled: true };
    expect(planMutation({ snapshot: () => null }, m)[0]?.newText).toBe('[plugins."a@m"]\nenabled = true\n');
  });
});
