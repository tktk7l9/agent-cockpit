# 05. Claude⇄Cursor skill comparison and sync

## Background / Goal

A skill with the same name can exist for several agents (real example: on this machine `publish-check` and `react-doctor` exist in both `~/.claude/skills` and `~/.cursor/skills`, and their contents can diverge). Detect and show content differences between same-named skills, and let the user sync them with a one-way copy. This is a differentiating feature only this app can offer.

## Spec

### Detection
- Targets: entities with `kind === "skill"` and `readOnly === false` (built-ins under `skills-cursor` are excluded)
- Same name = `name` (not the frontmatter name but the directory name behind `tag.name` … in the implementation, the tail of the entityId. Note that in the existing SkillEntity, `name` holds the frontmatter-preferred value — **the comparison key is the directory name derived from the file path**. Put logic equivalent to `fileBaseName` in lib)
- Definition of identical content: "frontmatter name/description/version match" AND "body matches exactly". Differences in frontmatterExtras are ignored (agent-specific keys may exist) — this definition MUST be stated in the UI

### UI
- SkillsView list row: if a same-named skill exists for another agent, show a tag `≡ synced` (identical, muted) or `≠ differs` (different, `--warn` color)
- In the editor pane, a **Compare section**: a selector for the counterpart entity (when there are two or more same-named ones) + diff display (use `buildDiffLines` directly in the renderer — lib is pure, so it can be imported) + 2 buttons:
  - `Copy to <counterpart agent>…` — overwrite the counterpart with this entity's content (upsertSkill mutation, via the normal diff preview)
  - `Copy from <counterpart agent>…` — the reverse direction
- A copy is always a "full overwrite of name/description/version/body". The counterpart's frontmatterExtras **survive**, because of upsertSkill's existing behavior (updateFrontmatter = keep keys other than the target keys)

### Scope
- Only user scope against user scope (project-scope skills are excluded — mixing them makes the UI too complex)
- Include Codex's `~/.codex/skills` as well (currently empty, but the format is the same)

## Implementation steps

### 1. lib: pairing and comparison (new `src/lib/skill-sync.ts`)

```ts
import type { SkillEntity } from "./model/types";

export interface SkillCounterpart { entity: SkillEntity; identical: boolean }

/** Get the directory name (= sync key) from a file path: "<dir>/<key>/SKILL.md" */
export function skillKey(filePath: string): string;

/** Group non-readOnly skills of the same user scope by key */
export function groupSkillsByKey(skills: SkillEntity[]): Map<string, SkillEntity[]>;

/** Compare: decide whether name/description/version/body match (frontmatterExtras ignored) */
export function skillsIdentical(a: SkillEntity, b: SkillEntity): boolean;

/** List the same-named skills of other agents, as seen from a given skill */
export function counterpartsOf(skill: SkillEntity, all: SkillEntity[]): SkillCounterpart[];
```

- Treat version `undefined` and `""` as equal (a missing version line on one side alone must not make it differs)
- body is an exact match (no trim — a trailing-newline difference also counts as a difference and is visible in the diff display)

### 2. renderer: extend SkillsView (MarkdownEntityView)

`MarkdownEntityView.tsx` is shared by skill/subagent/command, so create a dedicated child component `SkillCompare` (`src/renderer/src/components/SkillCompare.tsx`) and render the Compare section only when `kind === "skill"`:

- props: `{ entity: SkillEntity; all: SkillEntity[]; home: string }`
- List counterparts with `counterpartsOf`. With 0 results, show "No counterpart in other agents" + a **`Copy to…` selector** (new copy to an agent that does not have it: choose from a list equivalent to dirOptions → create new with upsertSkill)
- Diff display: `buildDiffLines(reconstructed text of the counterpart side, reconstructed text of my side)` … for reconstruction, normalize both sides with `buildFrontmatterFile({name, description, version}, body)` before comparing (diffing raw files would add noise from extras differences)
- Running the copy: `requestPreview({ op: "upsertSkill", dir: counterpart's skills directory, name: key, prevName: key, description: source.description, version: source.version, body: source.body })`
  - Counterpart directory: if the counterpart entity exists, derive it from `filePath` (strip `/<key>/SKILL.md`). If new, `${home}/.claude/skills` | `${home}/.codex/skills` | `${home}/.cursor/skills`
- List row tag: in the list rendering of `MarkdownEntityView`, look up `counterpartsOf` only for skills and attach the `≡/≠` tag (compute in bulk from the entity array with `useMemo` and turn it into a Map. Do not make it O(n²) per row)

## Tests

New `tests/skill-sync.test.ts` (all functions, all branches):
- `skillKey`: normal path / deeply nested path
- `groupSkillsByKey`: user only; readOnly excluded; project excluded
- `skillsIdentical`: exact match / body difference / description difference / version undefined vs "" is a match / real version difference
- `counterpartsOf`: does not include itself / identical flag / 0 results

Fixtures are hand-written synthetic SkillEntity values (use `entityId` to keep them consistent).

## Verification (real app)

1. Full gate suite green
2. `npx electron .` → Skills → `publish-check` (Claude) gets a `≠` or `≡` tag, and the Compare section shows the diff against the Cursor side
3. **Safe round-trip test**: with `~/.cursor/skills/react-doctor` as the target, Copy from Claude→Cursor → check the diff preview → Apply → cat the Cursor-side file to confirm → restore from Backups to return to the original state
4. For a skill with no counterpart (e.g. keihi), "No counterpart" + Copy to… appear (do not Apply)

## Completion criteria

- [ ] Verification passes (including the restore to original state in step 3)
- [ ] lib 100%×4 maintained (all branches of skill-sync.ts)
- [ ] Built-ins (skills-cursor) never appear as comparison or copy targets
- [ ] A copy does not erase the counterpart's frontmatterExtras (covered by a test: a fixture whose existing file has extra keys)
