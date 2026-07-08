import { Suspense, lazy } from "react";
import type { EditorLang } from "./CodeEditor";

// CodeMirror (~150kb+) is only needed once an editor pane is actually open,
// so it's split into its own chunk instead of bloating the initial bundle.
const Inner = lazy(() => import("./CodeEditor"));

interface Props {
  value: string;
  onChange?: (value: string) => void;
  lang: EditorLang;
  readOnly?: boolean;
  minHeight?: string;
}

export function LazyCodeEditor(props: Props): React.JSX.Element {
  return (
    <Suspense fallback={<div className="code-editor" style={{ minHeight: props.minHeight ?? "200px" }} />}>
      <Inner {...props} />
    </Suspense>
  );
}
