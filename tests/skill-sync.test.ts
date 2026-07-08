import { describe, expect, it } from "vitest";
import { entityId } from "../src/lib/model/ids";
import type { SkillEntity } from "../src/lib/model/types";
import { counterpartsOf, groupSkillsByKey, skillKey, skillsIdentical } from "../src/lib/skill-sync";

const USER = { level: "user" } as const;
const PROJ = { level: "project", projectPath: "/proj" } as const;

function skill(overrides: Partial<SkillEntity> & { agent: SkillEntity["agent"]; dirName: string }): SkillEntity {
  const scope = overrides.scope ?? USER;
  const dir = overrides.agent === "claude" ? "/h/.claude/skills" : overrides.agent === "codex" ? "/h/.codex/skills" : "/h/.cursor/skills";
  const filePath = `${dir}/${overrides.dirName}/SKILL.md`;
  return {
    id: entityId(overrides.agent, "skill", scope, overrides.dirName),
    agent: overrides.agent,
    kind: "skill",
    scope,
    filePath,
    readOnly: overrides.readOnly ?? false,
    name: overrides.name ?? overrides.dirName,
    description: overrides.description ?? "desc",
    version: overrides.version,
    frontmatterExtras: overrides.frontmatterExtras ?? {},
    body: overrides.body ?? "body\n",
  };
}

describe("skillKey", () => {
  it("extracts the parent directory name from a SKILL.md path", () => {
    expect(skillKey("/h/.claude/skills/keihi/SKILL.md")).toBe("keihi");
    expect(skillKey("/a/b/c/deep-nested-name/SKILL.md")).toBe("deep-nested-name");
  });
});

describe("groupSkillsByKey", () => {
  it("groups user-scope syncable skills by key, excluding readOnly and project scope", () => {
    const claude = skill({ agent: "claude", dirName: "keihi" });
    const cursor = skill({ agent: "cursor", dirName: "keihi" });
    const builtin = skill({ agent: "cursor", dirName: "automate", readOnly: true });
    const projectScoped = skill({ agent: "claude", dirName: "keihi", scope: PROJ, filePath: "/proj/.claude/skills/keihi/SKILL.md" });

    const groups = groupSkillsByKey([claude, cursor, builtin, projectScoped]);
    expect(groups.get("keihi")).toEqual([claude, cursor]);
    expect(groups.has("automate")).toBe(false);
    expect([...groups.values()].flat()).not.toContain(projectScoped);
  });

  it("returns an empty map for no syncable skills", () => {
    expect(groupSkillsByKey([])).toEqual(new Map());
  });
});

describe("skillsIdentical", () => {
  it("matches on full equality", () => {
    const a = skill({ agent: "claude", dirName: "k", description: "d", version: "1.0", body: "b\n" });
    const b = skill({ agent: "cursor", dirName: "k", description: "d", version: "1.0", body: "b\n" });
    expect(skillsIdentical(a, b)).toBe(true);
  });

  it("differs on body", () => {
    const a = skill({ agent: "claude", dirName: "k", body: "b1\n" });
    const b = skill({ agent: "cursor", dirName: "k", body: "b2\n" });
    expect(skillsIdentical(a, b)).toBe(false);
  });

  it("differs on description", () => {
    const a = skill({ agent: "claude", dirName: "k", description: "d1" });
    const b = skill({ agent: "cursor", dirName: "k", description: "d2" });
    expect(skillsIdentical(a, b)).toBe(false);
  });

  it("differs on name", () => {
    const a = skill({ agent: "claude", dirName: "k", name: "n1" });
    const b = skill({ agent: "cursor", dirName: "k", name: "n2" });
    expect(skillsIdentical(a, b)).toBe(false);
  });

  it("treats undefined version and empty-string version as equal", () => {
    const a = skill({ agent: "claude", dirName: "k", version: undefined });
    const b = skill({ agent: "cursor", dirName: "k", version: "" });
    expect(skillsIdentical(a, b)).toBe(true);
  });

  it("differs on a real version mismatch", () => {
    const a = skill({ agent: "claude", dirName: "k", version: "1.0" });
    const b = skill({ agent: "cursor", dirName: "k", version: "2.0" });
    expect(skillsIdentical(a, b)).toBe(false);
  });

  it("ignores frontmatterExtras differences", () => {
    const a = skill({ agent: "claude", dirName: "k", frontmatterExtras: { agentSpecific: "claude-only" } });
    const b = skill({ agent: "cursor", dirName: "k", frontmatterExtras: { other: 1 } });
    expect(skillsIdentical(a, b)).toBe(true);
  });
});

describe("counterpartsOf", () => {
  it("excludes itself and lists other-agent matches with identical flags", () => {
    const claude = skill({ agent: "claude", dirName: "k", description: "same" });
    const cursor = skill({ agent: "cursor", dirName: "k", description: "same" });
    const codex = skill({ agent: "codex", dirName: "k", description: "different" });
    const all = [claude, cursor, codex];

    const counterparts = counterpartsOf(claude, all);
    expect(counterparts).toHaveLength(2);
    expect(counterparts.find((c) => c.entity === cursor)?.identical).toBe(true);
    expect(counterparts.find((c) => c.entity === codex)?.identical).toBe(false);
    expect(counterparts.some((c) => c.entity === claude)).toBe(false);
  });

  it("returns an empty array when there is no counterpart", () => {
    const solo = skill({ agent: "claude", dirName: "keihi" });
    const other = skill({ agent: "claude", dirName: "money-sync" });
    expect(counterpartsOf(solo, [solo, other])).toEqual([]);
  });

  it("returns an empty array for readOnly (built-in) skills", () => {
    const builtin = skill({ agent: "cursor", dirName: "automate", readOnly: true });
    const claudeSide = skill({ agent: "claude", dirName: "automate" });
    expect(counterpartsOf(builtin, [builtin, claudeSide])).toEqual([]);
  });

  it("returns an empty array for project-scope skills", () => {
    const projSkill = skill({ agent: "claude", dirName: "k", scope: PROJ, filePath: "/proj/.claude/skills/k/SKILL.md" });
    const userSkill = skill({ agent: "cursor", dirName: "k" });
    expect(counterpartsOf(projSkill, [projSkill, userSkill])).toEqual([]);
  });

  it("skips non-syncable others (readOnly / project-scope) that share the same key", () => {
    const subject = skill({ agent: "claude", dirName: "k" });
    const readOnlyOther = skill({ agent: "cursor", dirName: "k", readOnly: true });
    const projectOther = skill({ agent: "cursor", dirName: "k", scope: PROJ, filePath: "/proj/.cursor/skills/k/SKILL.md" });
    const realCounterpart = skill({ agent: "codex", dirName: "k" });

    const counterparts = counterpartsOf(subject, [subject, readOnlyOther, projectOther, realCounterpart]);
    expect(counterparts.map((c) => c.entity)).toEqual([realCounterpart]);
  });

  it("does not match a same-agent same-key duplicate against itself but does match other duplicates", () => {
    const a = skill({ agent: "claude", dirName: "k" });
    const b = skill({ agent: "cursor", dirName: "k" });
    const counterparts = counterpartsOf(a, [a, b]);
    expect(counterparts.map((c) => c.entity)).toEqual([b]);
  });
});
