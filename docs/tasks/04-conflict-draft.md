# 04. Keep and re-apply the draft on conflict

## Background / Goal

When something external (Claude Code itself, an editor, git) rewrites a config file while the user is editing, the watcher shows a stale banner, but the only option today is "Reload (discard draft)". Add a path that does not throw the edits away.

## Current behavior (starting points for reading the code)

- `src/main/watcher` → `CHANNELS.changed` → `store.markStaleOrRefresh()`:
  - If `dirty || preview`, set `stale: true` (App.tsx shows `.banner-top`)
  - Otherwise, call `refresh()` immediately
- Key fact: **the save flow itself is already conflict-safe**. `preview` makes main read the fresh disk and run planMutation, so pressing Save… after an external change yields a correct diff of "current disk content + my draft". apply also checks the baseHash from preview time. In other words, "try to save while keeping the draft" **already works by just pressing the existing Save… button**
- The problem is UX: the banner offers only "discard and reload", so the user cannot tell that pressing Save… is fine. Also, refresh remounts the entity (`key={id}`) and the draft is lost

## Spec

1. Change the stale banner text and buttons:
   - Text: `Config files changed on disk. Your draft is still intact — you can keep editing and Save… (the diff preview always compares against the current file).`
   - Button 1: `Reload (discard draft)` — the existing refresh
   - Button 2: none (each editor already has Save…; do not duplicate a save button in the banner)
2. Add a **`Re-preview` button** to the conflict banner inside DiffModal (the case where baseHash mismatched on apply): re-run `requestPreview` with the current mutation to refresh the modal's diff and baseHash (today the user can only close it and press Save… again manually)
3. Losing the draft after a refresh is accepted as specified (Reload is an explicit discard action). Do not implement automatic merge

## Implementation steps

### 1. store

`src/renderer/src/store.ts`:

- `PreviewState` already holds `mutation`. Add a `repreview()` action:

```ts
repreview: async () => {
  const p = get().preview;
  if (!p?.mutation) return;               // restore previews are out of scope
  const result = await window.cockpit.preview(p.mutation);
  if (!result.ok) { get().showToast("err", result.error); set({ preview: null }); return; }
  set({ preview: { mutation: p.mutation, files: result.files, applying: false } }); // clears conflictPath
},
```

- For Re-preview on a restore (`mutation: null`): you may branch to call `requestRestorePreview(p.restoreId)` (if you implement this, a guard for undefined restoreId is mandatory)

### 2. DiffModal

In the conflict banner of `src/renderer/src/components/DiffModal.tsx`:

```tsx
<button className="btn btn-small" onClick={() => void repreview()}>Re-preview</button>
```

Also change the wording from "close and re-edit" to say that Re-preview can refresh to the latest diff.

### 3. App.tsx banner text

Replace it as in Spec 1. Keep the existing behavior where the `stale` flag is also cleared on a successful preview (apply ok → refresh).

## Tests

No lib changes (store/UI only) → no new lib tests needed. However:
- Keep `npm run typecheck` and the existing tests green
- Behavior is covered by the manual verification steps below

## Verification (real app, required)

1. Start with `npx electron .` → in Skills, edit the body of any skill (do not Save)
2. In another terminal, run `echo "external change" >> <path>` on the same SKILL.md — the banner appears with the new text, and **the editor draft is still there**
3. Press Save… as is → the DiffModal diff is based on "file after the external change + my draft" → Cancel
4. Conflict path: with a Save… preview open, change the file externally once more → Apply → conflict banner → `Re-preview` → the diff updates and Apply succeeds
5. Finally restore the target skill from the app's Backups (or revert with git) so no experiment traces remain

## Completion criteria

- [ ] Verification 1–5 pass
- [ ] typecheck / coverage / build green (lib 100% maintained — lib is untouched, so this should hold naturally)
- [ ] Pressing Re-preview on a restore preview (Backups tab) must not crash (if the branch is not implemented, hide the button)
