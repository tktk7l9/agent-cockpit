import { describe, expect, it } from "vitest";
import { buildInventory, discoverProjects, projectMarkers } from "../src/lib/inventory";
import type { McpServerEntity, PluginEntity, SettingsEntity, SkillEntity, TaggedSnapshot } from "../src/lib/model/types";

const HOME = "/Users/test";
const USER = { level: "user" } as const;
const PROJ = { level: "project", projectPath: "/proj" } as const;

const CLAUDE_GLOBAL = JSON.stringify({
  numStartups: 9,
  mcpServers: { keyway: { type: "stdio", command: "npx", args: ["-y", "keyway"], env: { TOKEN: "tok-value" } } },
  projects: {
    "/proj": {
      mcpServers: { mdn: { type: "http", url: "https://mdn" } },
      enabledMcpjsonServers: ["supabase"],
      disabledMcpjsonServers: ["disabled-one"],
    },
    "/gone": {},
  },
});

const CODEX_TOML = `
model = "gpt-5.2"

[projects."/proj"]
trust_level = "trusted"

[mcp_servers.node_repl]
command = "node"

[plugins."browser@openai-bundled"]
enabled = true
`;

function snaps(): TaggedSnapshot[] {
  return [
    { tag: { t: "claudeGlobalJson" }, path: `${HOME}/.claude.json`, text: CLAUDE_GLOBAL },
    {
      tag: { t: "claudeSettings", scope: USER, local: false },
      path: `${HOME}/.claude/settings.json`,
      text: JSON.stringify({ model: "opus", enabledPlugins: { "warp@claude-code-warp": true, "off@m": false } }),
    },
    { tag: { t: "claudeSettings", scope: USER, local: true }, path: `${HOME}/.claude/settings.local.json`, text: null },
    {
      tag: { t: "claudeInstalledPlugins" },
      path: `${HOME}/.claude/plugins/installed_plugins.json`,
      text: JSON.stringify({ version: 2, plugins: { "warp@claude-code-warp": [{ version: "1.2.3", installPath: "/x" }] } }),
    },
    { tag: { t: "codexConfig" }, path: `${HOME}/.codex/config.toml`, text: CODEX_TOML },
    { tag: { t: "mcpJson", agent: "cursor", scope: USER }, path: `${HOME}/.cursor/mcp.json`, text: "" },
    {
      tag: { t: "mcpJson", agent: "claude", scope: PROJ },
      path: "/proj/.mcp.json",
      text: JSON.stringify({
        mcpServers: {
          supabase: { type: "http", url: "https://s" },
          "disabled-one": { command: "x" },
          "unreviewed-one": { command: "y" },
        },
      }),
    },
    {
      tag: { t: "skill", agent: "claude", scope: USER, name: "keihi", readOnly: false },
      path: `${HOME}/.claude/skills/keihi/SKILL.md`,
      text: "---\nname: keihi\ndescription: expenses\nversion: 1.1.0\nextra: true\n---\nbody\n",
    },
    {
      tag: { t: "skill", agent: "cursor", scope: USER, name: "builtin", readOnly: true },
      path: `${HOME}/.cursor/skills-cursor/builtin/SKILL.md`,
      text: "no frontmatter body\n",
    },
    {
      tag: { t: "subagent", agent: "claude", scope: USER, name: "reviewer" },
      path: `${HOME}/.claude/agents/reviewer.md`,
      text: "---\nname: reviewer\ndescription: reviews\ntools: Read, Grep\nmodel: sonnet\ncustom: 1\n---\nprompt\n",
    },
    {
      tag: { t: "command", agent: "claude", scope: USER, name: "deploy" },
      path: `${HOME}/.claude/commands/deploy.md`,
      text: "---\ndescription: ship it\nallowed-tools: Bash\n---\nrun deploy\n",
    },
    {
      tag: { t: "instructions", agent: "codex", scope: USER, name: "AGENTS.md", readOnly: false },
      path: `${HOME}/.codex/AGENTS.md`,
      text: "# global\n",
    },
    {
      tag: { t: "instructions", agent: "codex", scope: USER, name: "default.rules", readOnly: true },
      path: `${HOME}/.codex/rules/default.rules`,
      text: "prefix_rule()\n",
    },
  ];
}

describe("buildInventory", () => {
  const inv = buildInventory(snaps(), ["/manual"]);

  it("collects claude user + project MCP servers", () => {
    const mcp = inv.entities.filter((e) => e.kind === "mcp") as McpServerEntity[];
    const keyway = mcp.find((e) => e.name === "keyway");
    expect(keyway?.source).toEqual({ kind: "claude-user" });
    expect(keyway?.env).toEqual({ TOKEN: "tok-value" });
    const mdn = mcp.find((e) => e.name === "mdn");
    expect(mdn?.scope).toEqual(PROJ);
    expect(mdn?.source).toEqual({ kind: "claude-project", projectPath: "/proj" });
  });

  it("gates .mcp.json servers with the enable/disable lists (three-state)", () => {
    const mcp = inv.entities.filter((e) => e.kind === "mcp") as McpServerEntity[];
    expect(mcp.find((e) => e.name === "supabase")?.enabled).toBe(true);
    expect(mcp.find((e) => e.name === "disabled-one")?.enabled).toBe(false);
    expect(mcp.find((e) => e.name === "unreviewed-one")?.enabled).toBeUndefined();
  });

  it("leaves .mcp.json servers ungated (undefined) when there is no project entry at all", () => {
    const inv2 = buildInventory(
      [
        {
          tag: { t: "mcpJson", agent: "claude", scope: { level: "project", projectPath: "/untracked" } },
          path: "/untracked/.mcp.json",
          text: JSON.stringify({ mcpServers: { x: { command: "y" } } }),
        },
      ],
      [],
    );
    const mcp = inv2.entities.filter((e) => e.kind === "mcp") as McpServerEntity[];
    expect(mcp.find((e) => e.name === "x")?.enabled).toBeUndefined();
  });

  it("collects codex MCP servers and plugins", () => {
    const mcp = inv.entities.filter((e) => e.kind === "mcp") as McpServerEntity[];
    expect(mcp.find((e) => e.name === "node_repl")?.source).toEqual({ kind: "codex" });
    const plugins = inv.entities.filter((e) => e.kind === "plugin") as PluginEntity[];
    const codexPlugin = plugins.find((p) => p.agent === "codex");
    expect(codexPlugin?.key).toBe("browser@openai-bundled");
    expect(codexPlugin?.marketplace).toBe("openai-bundled");
  });

  it("merges claude plugin enabled-state with installed metadata", () => {
    const plugins = inv.entities.filter((e) => e.kind === "plugin" && e.agent === "claude") as PluginEntity[];
    const warp = plugins.find((p) => p.key === "warp@claude-code-warp");
    expect(warp?.enabled).toBe(true);
    expect(warp?.version).toBe("1.2.3");
    expect(plugins.find((p) => p.key === "off@m")?.enabled).toBe(false);
  });

  it("emits settings entities with known keys", () => {
    const settings = inv.entities.filter((e) => e.kind === "settings") as SettingsEntity[];
    const claude = settings.find((s) => s.agent === "claude");
    expect(claude?.known).toEqual({ model: "opus" });
    const codex = settings.find((s) => s.agent === "codex");
    expect(codex?.format).toBe("toml");
    expect(codex?.known["model"]).toBe("gpt-5.2");
  });

  it("parses skills, subagents and commands", () => {
    const skill = inv.entities.find((e) => e.kind === "skill" && e.agent === "claude") as SkillEntity;
    expect(skill.description).toBe("expenses");
    expect(skill.frontmatterExtras).toEqual({ extra: true });
    const builtin = inv.entities.find((e) => e.kind === "skill" && e.readOnly) as SkillEntity | undefined;
    expect(builtin?.name).toBe("builtin");
    const sub = inv.entities.find((e) => e.kind === "subagent");
    expect(sub && "tools" in sub ? sub.tools : "").toBe("Read, Grep");
    const cmd = inv.entities.find((e) => e.kind === "command");
    expect(cmd && "frontmatterExtras" in cmd ? cmd.frontmatterExtras : {}).toEqual({ "allowed-tools": "Bash" });
  });

  it("emits instructions incl. read-only rules", () => {
    const rules = inv.entities.find((e): e is Extract<typeof e, { kind: "instructions" }> => e.kind === "instructions" && e.readOnly);
    expect(rules?.name).toBe("default.rules");
  });

  it("merges project discovery across sources", () => {
    const proj = inv.projects.find((p) => p.path === "/proj");
    expect(proj?.sources.sort()).toEqual(["claude", "codex"]);
    expect(proj?.codexTrustLevel).toBe("trusted");
    expect(inv.projects.find((p) => p.path === "/manual")?.sources).toEqual(["manual"]);
    expect(inv.projects.find((p) => p.path === "/gone")?.sources).toEqual(["claude"]);
  });

  it("has no errors on the happy path", () => {
    expect(inv.errors).toEqual([]);
  });
});

describe("buildInventory error handling", () => {
  it("records parse failures per file and continues", () => {
    const inv = buildInventory(
      [
        { tag: { t: "claudeGlobalJson" }, path: "/g.json", text: "{broken" },
        { tag: { t: "codexConfig" }, path: "/c.toml", text: "[broken" },
        { tag: { t: "claudeSettings", scope: USER, local: false }, path: "/s.json", text: "{alsobroken" },
        { tag: { t: "claudeInstalledPlugins" }, path: "/p.json", text: "{broken" },
        { tag: { t: "mcpJson", agent: "cursor", scope: USER }, path: "/m.json", text: "{broken" },
        {
          tag: { t: "skill", agent: "claude", scope: USER, name: "ok", readOnly: false },
          path: "/ok/SKILL.md",
          text: "---\nname: ok\ndescription: d\n---\nbody\n",
        },
      ],
      [],
    );
    expect(inv.errors.length).toBeGreaterThanOrEqual(3);
    expect(inv.entities.some((e) => e.kind === "skill")).toBe(true);
  });

  it("handles a fully absent environment", () => {
    const inv = buildInventory(
      [
        { tag: { t: "claudeGlobalJson" }, path: "/g.json", text: null },
        { tag: { t: "codexConfig" }, path: "/c.toml", text: null },
        { tag: { t: "claudeSettings", scope: USER, local: false }, path: "/s.json", text: null },
      ],
      [],
    );
    expect(inv.entities).toEqual([]);
    expect(inv.errors).toEqual([]);
    expect(inv.projects).toEqual([]);
  });

  it("reports installed-plugins parse failure when settings exist", () => {
    const inv = buildInventory(
      [
        {
          tag: { t: "claudeSettings", scope: USER, local: false },
          path: "/s.json",
          text: JSON.stringify({ enabledPlugins: { "a@m": true } }),
        },
        { tag: { t: "claudeInstalledPlugins" }, path: "/p.json", text: "{broken" },
      ],
      [],
    );
    expect(inv.errors.some((e) => e.path === "/p.json")).toBe(true);
    expect((inv.entities.find((e) => e.kind === "plugin") as PluginEntity).key).toBe("a@m");
  });
});

describe("discoverProjects / projectMarkers", () => {
  it("unions claude and codex project paths", () => {
    expect(discoverProjects(CLAUDE_GLOBAL, CODEX_TOML).sort()).toEqual(["/gone", "/proj"]);
  });

  it("survives unreadable inputs", () => {
    expect(discoverProjects("{broken", "[broken")).toEqual([]);
    expect(discoverProjects(null, null)).toEqual([]);
  });

  it("lists marker files", () => {
    expect(projectMarkers("/p")).toContain("/p/.mcp.json");
    expect(projectMarkers("/p")).toContain("/p/AGENTS.md");
  });
});
