import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

export type EditorLang = "markdown" | "json" | "toml" | "text";

function langExtension(lang: EditorLang): Extension {
  if (lang === "markdown") return markdown();
  if (lang === "json") return json();
  if (lang === "toml") return StreamLanguage.define(toml);
  return [];
}

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", fontSize: "12.5px", height: "100%" },
    ".cm-content": { fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", caretColor: "#7dd3fc" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#4b5563", border: "none" },
    "&.cm-focused": { outline: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(125, 211, 252, 0.05)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(125,211,252,0.18)" },
    ".cm-cursor": { borderLeftColor: "#7dd3fc" },
  },
  { dark: true },
);

interface Props {
  value: string;
  onChange?: (value: string) => void;
  lang: EditorLang;
  readOnly?: boolean;
  minHeight?: string;
}

export function CodeEditor({ value, onChange, lang, readOnly = false, minHeight = "200px" }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const readOnlyComp = useRef(new Compartment());

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          langExtension(lang),
          theme,
          EditorView.lineWrapping,
          readOnlyComp.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyComp.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  return <div className="code-editor" style={{ minHeight }} ref={hostRef} />;
}
