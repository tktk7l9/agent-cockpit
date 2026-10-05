# 10. Persist window state and section

## Background / goal

On every launch the window returns to the default 1280x820 position and the MCP section. Restore the previous window rectangle and the displayed section.

## Spec

- Save the window position and size on quit and restore them on the next launch. If the restored rectangle is outside the current displays, fall back to the defaults (handles an unplugged external monitor)
- Restore the last displayed section (the Section type: "mcp" to "backups") and the agent filter
- Storage: window rectangle = `userData/app-config.json` (extend the existing state.ts). Section/filter = the renderer's `localStorage` (pure UI state that does not need to go through main)

## Implementation steps

### 1. main: window rectangle

Add `windowBounds?: { x: number; y: number; width: number; height: number }` to `AppConfig` in `src/main/state.ts` (`loadAppConfig` ignores invalid values and returns undefined).

`createWindow()` in `src/main/index.ts`:

```ts
const saved = loadAppConfig(userData()).windowBounds;
const visible = saved && screen.getAllDisplays().some((d) => {
  const a = d.workArea;
  return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
});
new BrowserWindow({ ...(visible ? saved : { width: 1280, height: 820 }), ... })
```

Save timing: call `saveAppConfig` (with `mainWindow.getBounds()`) on `resize`/`move`, debounced by 500ms. Also save immediately on `close`. Import `screen` from `electron` (usable only after app ready — createWindow runs inside whenReady, so this is fine).

### 2. renderer: section/filter

`src/renderer/src/store.ts`:

```ts
const persisted = (() => {
  try { return JSON.parse(localStorage.getItem("ui-state") ?? "{}") as { section?: Section; agentFilter?: AgentId | "all" }; }
  catch { return {}; }
})();
```

- Initial value: `section: isValidSection(persisted.section) ? persisted.section : "mcp"` (write a validator — it must tolerate values from older builds or hand-corrupted data)
- Inside `setSection` / `setAgentFilter`, call `localStorage.setItem("ui-state", JSON.stringify({ section, agentFilter }))`
- **Note**: do not persist `selectedId` (the entity may have disappeared after a rescan; an invalid id would only show as unselected, but this avoids unintentionally expanding the edit pane)

## Tests

- No lib changes (if isValidSection is written inside the store). **If** the validator etc. is extracted as a function, put it under the renderer, not lib (lib is the domain layer; no UI state in it)
- Write the bounds validity check (display intersection test) as a pure function `boundsVisible(bounds, workAreas)` decoupled from `electron.screen`, put it in `src/lib/window-bounds.ts`, and test it to 100% (recommended over keeping it untested inside main):

```ts
// src/lib/window-bounds.ts
export interface Rect { x: number; y: number; width: number; height: number }
export function boundsVisible(saved: Rect, workAreas: Rect[]): boolean;
```

`tests/window-bounds.test.ts`: fully contained / partially intersecting / fully outside / empty workAreas.

## Verification (real device)

1. The full gate suite is green
2. Move and resize the window -> switch to the Skills tab + Codex filter and quit -> relaunch -> everything is restored
3. windowBounds is written to `userData/app-config.json` (`~/Library/Application Support/agent-cockpit/`) and the **projects array is not corrupted**
4. Off-display fallback: hand-edit windowBounds.x in app-config.json to 99999 -> launch -> the window appears at the default size and on screen

## Definition of done

- [ ] All 4 verification points pass
- [ ] lib 100%x4 maintained (all branches of window-bounds.ts if it is placed in lib)
- [ ] No interference with the existing projects persistence (Add folder) (confirm: add -> restart -> still present)
