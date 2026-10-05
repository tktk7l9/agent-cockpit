# 11. Scan errors detail panel

## Background / goal

Config files that failed to parse (`ScanResultPayload.errors: { path, message }[]`) can currently only be seen through the **title tooltip** of "⚠ N file(s) could not be parsed" at the bottom of the sidebar. Open a detail modal on click and give each error an action.

## Spec

- Turn the sidebar `.scan-errors` into a button. Clicking it shows a modal
- Modal content: one row per error — `path` (`.mono`, truncated + title) / `message` / two actions:
  - `Reveal in Finder` (the existing `RevealButton`)
  - `Open raw` (only if that file is a settings-type file readable as a SettingsEntity -> jump to the entity. Files that failed to parse are often not turned into entities, so hide it when none exists)
- When there are 0 errors, hide `.scan-errors` itself (keep the current behavior)
- Put a Rescan button in the modal footer (it just calls `refresh()`)

## Implementation steps

1. `src/renderer/src/store.ts`: add `errorsOpen: boolean` + open/close actions
2. New `src/renderer/src/components/ScanErrorsModal.tsx`: reuse `.modal-backdrop`/`.modal`. Display `data.errors`. "Open raw" runs `setSection("settings"); select(id); close()` only if `data.entities.find(e => e.kind === "settings" && e.filePath === err.path)` finds a match
3. `App.tsx`: change `.scan-errors` to a `<button>` (keep the current style + hover). Mount the modal alongside DiffModal
4. Accessibility: give the modal `role="dialog"` and `aria-label="Scan errors"`, close it with Esc (backdrop click follows the existing behavior)

## Tests

No lib changes. Only typecheck must stay green. The error display itself is checked in the verification steps.

## Verification (real device)

1. The full gate suite is green
2. Break a file deliberately, but on a **safe target** rather than something like `echo "{broken" > /tmp/<arbitrary-file>` — for example write `{broken` to `~/.cursor/mcp.json` (currently 0 bytes) -> the app's watcher picks it up and the sidebar shows ⚠ 1 -> click -> the modal shows the path and the jsonc error message -> Reveal opens Finder
3. Reset `~/.cursor/mcp.json` to empty (`: > ~/.cursor/mcp.json`) -> Rescan -> the ⚠ disappears
4. With 0 errors, no trace remains anywhere in the UI

## Definition of done

- [ ] Verification passes (including restoring the broken file)
- [ ] typecheck / coverage / build green
- [ ] Error messages must not contain file contents themselves (message is only a short parser-derived sentence — prevents leaking env values, etc.)
