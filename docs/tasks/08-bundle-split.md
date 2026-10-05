# 08. Renderer bundle split (CodeMirror dynamic import)

## Background / goal

The renderer JS is a single chunk of about 1.77MB (React + zustand + CodeMirror 6, all bundled). CodeMirror is not needed until the editor pane is opened, so load it lazily and shrink the initial chunk. This is a desktop app, so the practical impact is small, but it improves perceived startup time and design hygiene.

## Spec

- Convert the `CodeEditor` component (src/renderer/src/components/CodeEditor.tsx) to `React.lazy` + dynamic import
- CodeMirror packages (`codemirror`, `@codemirror/*`) must **disappear from the initial chunk** and live in a dedicated chunk
- The loading fallback is a placeholder with the same dimensions as `.code-editor` (no layout shift)
- No change in functionality or appearance (lang switching, readOnly and onChange behavior preserved)

## Implementation steps

1. Leave `CodeEditor.tsx` as is (add a default export: `export default CodeEditor;`)
2. New file `src/renderer/src/components/LazyCodeEditor.tsx`:

```tsx
import { Suspense, lazy } from "react";
import type { EditorLang } from "./CodeEditor";
const Inner = lazy(() => import("./CodeEditor"));
interface Props { value: string; onChange?: (v: string) => void; lang: EditorLang; readOnly?: boolean; minHeight?: string }
export function LazyCodeEditor(props: Props) {
  return (
    <Suspense fallback={<div className="code-editor" style={{ minHeight: props.minHeight ?? "200px" }} />}>
      <Inner {...props} />
    </Suspense>
  );
}
```

- **Note**: importing the `EditorLang` type with `import type` is only a static type reference, so the chunk split is preserved. Adding a static value import (basicSetup, etc.) to LazyCodeEditor breaks the split
3. In the 3 consumer files (MarkdownEntityView / SettingsView / InstructionsView), replace the `CodeEditor` import with `LazyCodeEditor`
4. Build and verify: in the `npm run build` output, `out/renderer/assets/` must contain separate index and CodeMirror chunks. Record the size of `index-*.js` before/after

## Tests

No lib changes. Only typecheck and existing tests must stay green.

## Verification

1. `npm run build` -> confirm the chunk split in the build log (the index chunk should be 700KB or less as a guideline, and the CodeMirror chunk a separate file)
2. `npx electron .` -> the editor must display and edit correctly in each view (Skills/Settings/Instructions). A brief placeholder flash on first display is acceptable
3. Dynamic chunk loading works under the production CSP (`script-src 'self'` allows same-origin dynamic imports, so it should pass — always confirm on a real run)

## Definition of done

- [ ] codemirror is gone from the initial chunk (`npx source-map-explorer` etc. is not needed; the file sizes in the build log plus `grep -c basicSetup out/renderer/assets/index-*.js` returning 0 are enough)
- [ ] All 3 verification points pass
- [ ] No layout shift (placeholder minHeight matches)
