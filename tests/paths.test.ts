import { describe, expect, it } from "vitest";
import { entityId, scopeKey } from "../src/lib/model/ids";
import {
  allowedRoots,
  claudeDir,
  claudeGlobalJsonPath,
  codexConfigPath,
  codexDir,
  cursorDir,
  isPathAllowed,
  isPathDenied,
  scanSpec,
  skillFilePath,
  watchPaths,
} from "../src/lib/paths";

const HOME = "/Users/test";

describe("ids", () => {
  it("builds stable ids per scope", () => {
    expect(scopeKey({ level: "user" })).toBe("user");
    expect(scopeKey({ level: "project", projectPath: "/p" })).toBe("proj:/p");
    expect(entityId("claude", "mcp", { level: "user" }, "keyway")).toBe("claude:mcp:user:keyway");
  });
});

describe("path helpers", () => {
  it("derives standard locations from home", () => {
    expect(claudeGlobalJsonPath(HOME)).toBe("/Users/test/.claude.json");
    expect(claudeDir(HOME)).toBe("/Users/test/.claude");
    expect(codexDir(HOME)).toBe("/Users/test/.codex");
    expect(cursorDir(HOME)).toBe("/Users/test/.cursor");
    expect(codexConfigPath(HOME)).toBe("/Users/test/.codex/config.toml");
    expect(skillFilePath("/d", "s")).toBe("/d/s/SKILL.md");
  });
});

describe("scanSpec", () => {
  it("covers user-scope surfaces", () => {
    const spec = scanSpec(HOME, []);
    const files = spec.files.map((f) => f.path);
    expect(files).toContain("/Users/test/.claude.json");
    expect(files).toContain("/Users/test/.claude/settings.json");
    expect(files).toContain("/Users/test/.codex/config.toml");
    expect(files).toContain("/Users/test/.cursor/mcp.json");
    const dirs = spec.dirs.map((d) => d.dir);
    expect(dirs).toContain("/Users/test/.claude/skills");
    expect(dirs).toContain("/Users/test/.cursor/skills-cursor");
    expect(dirs).toContain("/Users/test/.claude/agents");
    expect(dirs).toContain("/Users/test/.codex/rules");
  });

  it("adds project-scope surfaces and tags", () => {
    const spec = scanSpec(HOME, ["/proj"]);
    const files = spec.files.map((f) => f.path);
    expect(files).toContain("/proj/.mcp.json");
    expect(files).toContain("/proj/.cursor/mcp.json");
    expect(files).toContain("/proj/AGENTS.md");
    const skillsDir = spec.dirs.find((d) => d.dir === "/proj/.claude/skills");
    expect(skillsDir).toBeDefined();
    expect(skillsDir?.makeTag("x")).toEqual({
      t: "skill",
      agent: "claude",
      scope: { level: "project", projectPath: "/proj" },
      name: "x",
      readOnly: false,
    });
    // exercise every makeTag closure
    for (const d of spec.dirs) {
      const tag = d.makeTag("n");
      expect(tag.t).toBeTruthy();
    }
  });

  it("watchPaths dedupes files and dirs", () => {
    const paths = watchPaths(HOME, ["/proj"]);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/Users/test/.claude.json");
    expect(paths).toContain("/proj/.claude/skills");
  });
});

describe("path access control", () => {
  it("denies sensitive basenames", () => {
    expect(isPathDenied("/Users/test/.codex/auth.json")).toBe(true);
    expect(isPathDenied("/p/.env.local")).toBe(true);
    expect(isPathDenied("/p/aws_credentials")).toBe(true);
    expect(isPathDenied("/p/client_secret.json")).toBe(true);
    expect(isPathDenied("/p/github_token")).toBe(true);
    expect(isPathDenied("/Users/test/.claude.json")).toBe(false);
  });

  it("allows only known roots", () => {
    const roots = allowedRoots(HOME, ["/proj"]);
    expect(roots).toContain("/Users/test/.claude.json");
    expect(isPathAllowed(HOME, ["/proj"], "/Users/test/.claude/settings.json")).toBe(true);
    expect(isPathAllowed(HOME, ["/proj"], "/Users/test/.claude.json")).toBe(true);
    expect(isPathAllowed(HOME, ["/proj"], "/proj/.mcp.json")).toBe(true);
    expect(isPathAllowed(HOME, ["/proj"], "/etc/passwd")).toBe(false);
    expect(isPathAllowed(HOME, [], "/proj/.mcp.json")).toBe(false);
  });

  it("rejects traversal and denied files even under allowed roots", () => {
    expect(isPathAllowed(HOME, [], "/Users/test/.claude/../.ssh/id_rsa")).toBe(false);
    expect(isPathAllowed(HOME, [], "/Users/test/.codex/auth.json")).toBe(false);
  });
});
