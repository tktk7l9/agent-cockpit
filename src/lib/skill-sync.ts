// Cross-agent Skill comparison (Claude Code <-> Codex <-> Cursor). A skill is
// "the same skill" across agents when it lives in a same-named directory
// under each agent's user-scope skills/ dir. Pure: compares already-parsed
// SkillEntity objects, no fs access.

import type { SkillEntity } from "./model/types";

export interface SkillCounterpart {
  entity: SkillEntity;
  identical: boolean;
}

/** Directory name a skill lives in — "<dir>/<key>/SKILL.md" — used as the sync key. */
export function skillKey(filePath: string): string {
  // SkillEntity.filePath is always "<dir>/<name>/SKILL.md", so there are
  // always at least two path segments before the filename.
  const parts = filePath.split("/");
  return parts[parts.length - 2] as string;
}

function isSyncable(skill: SkillEntity): boolean {
  return !skill.readOnly && skill.scope.level === "user";
}

/** Groups syncable (user-scope, non-built-in) skills by their directory-name key. */
export function groupSkillsByKey(skills: SkillEntity[]): Map<string, SkillEntity[]> {
  const map = new Map<string, SkillEntity[]>();
  for (const skill of skills) {
    if (!isSyncable(skill)) continue;
    const key = skillKey(skill.filePath);
    const group = map.get(key);
    if (group) group.push(skill);
    else map.set(key, [skill]);
  }
  return map;
}

function normalizedVersion(skill: SkillEntity): string {
  return skill.version ?? "";
}

/** name/description/version/body equality; frontmatterExtras differences are ignored. */
export function skillsIdentical(a: SkillEntity, b: SkillEntity): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    normalizedVersion(a) === normalizedVersion(b) &&
    a.body === b.body
  );
}

/** Other agents' skills sharing this skill's directory-name key. */
export function counterpartsOf(skill: SkillEntity, all: SkillEntity[]): SkillCounterpart[] {
  if (!isSyncable(skill)) return [];
  const key = skillKey(skill.filePath);
  const out: SkillCounterpart[] = [];
  for (const other of all) {
    if (other === skill) continue;
    if (!isSyncable(other)) continue;
    if (skillKey(other.filePath) !== key) continue;
    out.push({ entity: other, identical: skillsIdentical(skill, other) });
  }
  return out;
}
