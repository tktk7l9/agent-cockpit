# 03. Dedicated permissions Editor

## Background / Goal

Claude Code's permission settings (the string arrays `permissions.allow` / `permissions.deny`, and `permissions.defaultMode`) can currently only be touched through raw JSON editing in SettingsView. Add per-row add/delete UI and a dropdown for defaultMode so they can be edited safely without opening the raw editor.

## Target files (both read and write)

- `~/.claude/settings.json` (user)
- `<project>/.claude/settings.json` / `settings.local.json` (project; real example: many files across these repositories contain only `{ permissions: { allow: [...] } }`)

All of them are already scanned (`SnapshotTag: claudeSettings` → `SettingsEntity`).

## Specification

- In the editor pane of SettingsView, add a **Permissions section** for settings entities with `agent === "claude"` (above the raw editor)
  - `defaultMode`: a dropdown. Options = `default` / `acceptEdits` / `plan` / `bypassPermissions` + "(unset)" + an escape hatch for free input (put "custom…" in the select, and choosing it shows a text input). Assuming the value set is not guaranteed to be exhaustive, **if the current value is not among the options, display it as is**
  - `allow` / `deny`: a string-list editor for each. 1 row = 1 rule (e.g. `Bash(npm run build)`, `Read(~/.zshrc)`). Rows can be added, edited, and deleted; the original order is preserved
- Saving uses a Save button dedicated to the Permissions section (independent of the raw Save). One click bundles the changes to defaultMode/allow/deny into a single diff preview
- Do not validate rule strings (Claude Code's spec is broad). Only remove empty lines

## Implementation steps

### 1. lib: extend the known extraction

`claudeSettingsKnown` in `src/lib/agents/claude.ts` is a flat map for quick-edit, so **do not touch it**. Add a dedicated reader instead:

```ts
export interface ClaudePermissions {
  defaultMode?: string;
  allow: string[];
  deny: string[];
  present: boolean; // whether the permissions key itself exists
}
export function claudePermissions(text: string | null): ClaudePermissions;
```

Ignore non-array / non-string values and fail safe (the same kind of defense as `stringList` in the existing readers. Test every branch you write).

### 2. lib: add a Mutation

```ts
| { op: "setPermissions"; filePath: string; defaultMode?: string | null; allow?: string[]; deny?: string[] }
```

- A field that is `undefined` means "do not change". `defaultMode: null` means "delete the key" (removeJsonKey)
- Planner: apply `setJsonValue(text, ["permissions", "allow"], allow)` etc. per field. If the file is absent (a project without settings.local.json, etc.), it is created from `{}` (`setJsonValue` already handles null text)
- Do not forget to add it to `mutationReadPaths`

### 3. renderer

- New `src/renderer/src/components/StringListEditor.tsx`: `{ label, items, onChange }`. Using KvEditor.tsx as a reference, one-column input + ✕ button + `+ add`. Reordering is not needed (do not implement it)
- Add the Permissions section to `SettingsEditor` in `SettingsView.tsx`. The initial value is `claudePermissions(entity.rawText)` (importing lib directly from the renderer is fine because lib is pure). The draft is useState, and Save… calls `requestPreview({ op: "setPermissions", ... })`
- **Note**: the raw editor and the Permissions section are separate drafts of the same file. Applying Permissions makes the raw content stale. After a successful Apply the store refreshes and the component remounts, so raw is updated too (`key={selected.id}` is already in place). No special handling is needed, but understand this behavior

### 4. Path for when settings.local.json does not exist (optional, recommended)

For project scope, when there is no settings.local.json entity, it does not appear in SettingsView's list. This is **out of scope** this time (editing existing files only). However, do not leave a code comment saying that task 07 (adding agents) could generalize this into a "create new file" path (comment convention: do not write motivation comments).

## Tests

- `tests/agents.test.ts`: `claudePermissions` — fully specified / no permissions / allow is not an array / elements are not strings / defaultMode is not a string
- `tests/mutations.test.ts`: setPermissions — changing only allow leaves deny/defaultMode/other keys byte-identical / `defaultMode: null` deletes the key / creation from an absent file / writing an empty array / mutationReadPaths

## Verification

1. All gates green
2. On a real machine: add one line to allow in `<repo>/.claude/settings.local.json` (e.g. parkour-cat) → the diff preview is only the addition of one array element → Apply → check the actual file → delete it to revert
3. Change defaultMode in `~/.claude/settings.json` with the dropdown → preview → **Cancel without Applying** (do not break the real operational values)

## Completion criteria

- [ ] Verification passes (for 2, including the round trip)
- [ ] lib stays at 100%×4
- [ ] The Permissions section is not shown for codex's config.toml (settings, format: "toml")
- [ ] No diff appears in keys other than permissions (enabledPlugins, etc.)
