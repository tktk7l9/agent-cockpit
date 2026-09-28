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

// Colors are CSS custom properties (--caret/--selection/--active-line/--text-muted)
// so this single theme spec re-paints automatically when styles.css's
// `prefers-color-scheme: light` block takes over — no JS listener needed for
// color, only for the `dark` flag itself (see themeCompartment below).
function buildTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": { backgroundColor: "transparent", fontSize: "12.5px", height: "100%" },
      ".cm-content": { fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", caretColor: "var(--caret)" },
      ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-muted)", border: "none" },
      "&.cm-focused": { outline: "none" },
      ".cm-activeLine": { backgroundColor: "var(--active-line)" },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--selection)" },
      ".cm-cursor": { borderLeftColor: "var(--caret)" },
    },
    { dark },
  );
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

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
  const themeComp = useRef(new Compartment());
  // True while the editor is being synced to a new `value` prop; that change is not user input,
  // so it must not be reported back through onChange (it would recreate a just-discarded draft).
  const syncingRef = useRef(false);

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
          themeComp.current.of(buildTheme(prefersDark())),
          EditorView.lineWrapping,
          readOnlyComp.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingRef.current) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = (): void => {
      view.dispatch({ effects: themeComp.current.reconfigure(buildTheme(media.matches)) });
    };
    media.addEventListener("change", onThemeChange);

    return () => {
      media.removeEventListener("change", onThemeChange);
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
      syncingRef.current = true;
      try {
        view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
      } finally {
        syncingRef.current = false;
      }
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyComp.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  return <div className="code-editor" style={{ minHeight }} ref={hostRef} />;
}

export default CodeEditor;
