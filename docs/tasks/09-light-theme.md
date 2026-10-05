# 09. Light theme support

## Background / goal

The app is currently fixed to a dark theme. Add a light theme that automatically follows the macOS appearance setting (`prefers-color-scheme`). Do not implement a manual toggle (OS-follow only — avoids adding complexity to an app that has no settings UI).

## Spec

- When `prefers-color-scheme: light` applies, the whole UI uses light colors. Switching follows OS setting changes immediately (automatic, since it is a media query)
- Agent colors (--claude/--codex/--cursor) are shared by both themes. However, check their visibility on light, and if needed you may introduce `--claude-fg`-style variants with slightly adjusted lightness
- The CodeMirror editor and the diff view also follow the light colors
- The window background (the main process `backgroundColor: "#101418"`) and the title bar also follow

## Implementation steps

### 1. CSS (this covers most of the work)

Add right after `:root` in `src/renderer/src/styles.css`:

```css
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f5f7fa;
    --bg-panel: #ffffff;
    --bg-raised: #eef1f5;
    --border: #d5dce4;
    --text: #1f2933;
    --text-muted: #64748b;
    --accent: #0969da;
    --accent-soft: rgba(9, 105, 218, 0.12);
    /* adjust ok/warn/danger only if they look washed out on light */
  }
}
```

- Find hard-coded rgba usages: `grep -n "rgba(" src/renderer/src/styles.css`. White rgba values that assume a black background (the `.switch` track, the `.diff-add/del` backgrounds, etc.) must become CSS variables and be overridden on the light side
- The 55% black `.modal-backdrop` works on light too, so it can stay

### 2. CodeMirror theme

The `theme` in `CodeEditor.tsx` is fixed to `{ dark: true }`. Handle it as follows:

```ts
const isDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
```

- Prepare a light `EditorView.theme({...}, { dark: false })` and hold it in a Compartment. Use `matchMedia(...).addEventListener("change", ...)` to `dispatch({ effects: themeComp.reconfigure(...) })` (the same Compartment pattern already exists for readOnly, so follow it)
- Colors: change the `#7dd3fc`-family caret/selection colors to the `#0969da` family on light

### 3. Main process

`src/main/index.ts`:

```ts
import { nativeTheme } from "electron";
backgroundColor: nativeTheme.shouldUseDarkColors ? "#101418" : "#f5f7fa",
```

- Switching after startup: use `nativeTheme.on("updated", ...)` to call `mainWindow.setBackgroundColor(...)` (the only purpose is to prevent flicker, so it is not required if the renderer CSS already follows, but it makes the underlying color match during resize)

## Tests

No lib changes. Only typecheck must stay green.

## Verification (real device, visual)

1. System Settings -> Appearance -> Light -> visually inspect every app view (9 sections + DiffModal + palettes). Zero places where text is unreadable or borders vanish
2. Switch back to dark and confirm no regression
3. Switch the appearance while the app is running and confirm it follows immediately (no restart)
4. CodeMirror (the Skills body, the Settings raw view, the diff view) must be readable on light
5. Take screenshots in both themes and attach them to the PR

## Definition of done

- [ ] All 5 verification points pass
- [ ] The remaining hard-coded colors from `grep -n "#[0-9a-fA-F]\{3,6\}" src/renderer/src/styles.css` are only intentional ones (CSS variable definitions, colors shared by both themes)
- [ ] AgentBadge / chips / pills / switch / toast have sufficient contrast on light (WCAG AA as a guideline)
