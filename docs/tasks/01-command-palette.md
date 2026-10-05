# 01. Cmd+K Command Palette (Cross-Entity Search)

## Background / Goal

There are 39 Skills alone, and scanning the list by eye has hit its limit. Add a palette that incrementally searches all entities (MCP/Skill/Subagent/Command/Plugin/Settings/Instructions) from a single input and jumps to the matching view on Enter. The feel is the same as VS Code's Cmd+P / Raycast.

## Specification

- **Open**: `⌘K` (global, works even while an input/textarea has focus). `Esc` closes it. Background scrolling is stopped while the palette is shown
- **Search targets**: all of `data.entities` + fixed actions (navigate to each section = 9 items such as "Go to MCP Servers", and "Add project folder…")
- **Matching**: case-insensitive subsequence match (fzf style). The target strings are `name` and, if present, `description`. Score = consecutive-match bonus + prefix-match bonus − position penalty (details are left to the implementation, but it must be deterministic)
- **Display**: top 20 results. Each row = kind icon character (MCP=`⚡` Skill=`◆` Subagent=`🤖` Command=`/` Plugin=`🔌` Settings=`⚙` Instructions=`📋`) + name + `AgentBadge` + `ScopeTag`. `↑↓` to select, `Enter` to confirm, click also confirms
- **Confirm action**: entity → `setSection(kind)` + `select(id)`. Section-navigation action → `setSection`. Add project → `window.cockpit.addProject()`
- **Empty query**: show only the list of fixed actions (do not show entities)

## Implementation steps

### 1. lib: search logic (becomes subject to the 100% gate)

New `src/lib/search.ts`:

```ts
export interface SearchItem { id: string; label: string; sublabel?: string }
export interface SearchHit { item: SearchItem; score: number }

/** Case-insensitive subsequence match. Returns null if there is no match. The score is deterministic */
export function fuzzyScore(query: string, text: string): number | null;
/** Evaluates items in the order fuzzyScore(label) → fuzzyScore(sublabel) and returns the top N in descending order */
export function searchItems(query: string, items: SearchItem[], limit?: number): SearchHit[];
```

- `fuzzyScore` spec: it matches if every character of query appears in text in order. Base score = match, +3 per consecutive match, +5 for a word-start match (start of text or preceded by one of `-_./ `), −0.1×start position. An empty query returns `null` (the caller handles the empty-query branch)
- **Note**: every branch you write needs a test. Do not add "clever" branches that are not in the spec

### 2. renderer: palette component

New `src/renderer/src/components/CommandPalette.tsx`:

- Get `data` / `setSection` / `select` from `useStore`
- Build `items` with `useMemo`: entity → `{ id: e.id, label: e.name ?? e.key, sublabel: description etc. }` + keep kind/agent/scope in a separate Map. Fixed actions use `id: "action:<name>"`
- Register the `⌘K` listener in a `useEffect` in `App.tsx` with `window.addEventListener("keydown", ...)` (`e.metaKey && e.key === "k"` calls preventDefault → add `paletteOpen: boolean` to the store to open/close)
- Look: reuse `.modal-backdrop`, with a 560px-wide panel positioned 15vh from the top. Add styles using the existing CSS variables (append the `.palette` class group to styles.css)
- `PluginEntity` has no `name` (it has `key`). `SettingsEntity`/`InstructionsEntity` have `name`. Watch out for union narrowing (00-conventions §5)

### 3. Store extension

Add `paletteOpen: boolean` / `openPalette()` / `closePalette()` to `src/renderer/src/store.ts`. Use the existing `select` (when jumping to an entity in a different section, call `setSection` → `select` in that order. `setSection` clears selectedId, so the order is mandatory).

## Tests

New `tests/search.test.ts`:
- match / no match / empty query returns null / case-insensitive
- Score order: concrete examples where exact match > prefix match > scattered match
- Concrete examples where the consecutive-match bonus and word-start bonus take effect (e.g. `"mcp"` vs `"my-cool-plugin"` and `"mcp-server"`)
- `searchItems`: limit behavior, sublabel fallback, empty array when nothing matches

The UI part (key events, rendering) is outside the gate and tests are not required, but `npm run typecheck` must always pass.

## Verification

1. `npm run typecheck && npm run coverage && npm run build` all green (lib stays at 100%×4)
2. `npx electron .` → `⌘K` → type `keihi` and confirm the Skill keihi comes out on top and Enter jumps to it
3. `⌘K` → with an empty query only fixed actions are shown → "Go to Backups" navigates to the section
4. `⌘K` opens even while the editor (CodeMirror) has focus

## Completion criteria

- [ ] All 4 verification points above pass
- [ ] `fuzzyScore`/`searchItems` have every branch covered in tests/search.test.ts
- [ ] While the palette is shown, the UI behind it cannot be operated (clicking the backdrop closes it)
- [ ] No new dependency packages (do not add a fuzzy library; the in-house implementation is the thing under test)
