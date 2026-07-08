import { useStore } from "../store";

export function DiffModal(): React.JSX.Element | null {
  const preview = useStore((s) => s.preview);
  const confirmApply = useStore((s) => s.confirmApply);
  const cancelPreview = useStore((s) => s.cancelPreview);
  const repreview = useStore((s) => s.repreview);
  if (!preview) return null;

  const changed = preview.files.some((f) => f.diff.some((l) => l.type === "add" || l.type === "del") || f.deletes);

  return (
    <div className="modal-backdrop" onClick={cancelPreview}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{preview.mutation ? "Review changes" : "Restore backup"}</h2>
          <span className="muted">{preview.files.length} file(s)</span>
        </header>
        {preview.conflictPath && (
          <div className="banner banner-warn">
            <span>
              File changed on disk since preview: <code>{preview.conflictPath}</code> — Re-preview to refresh the
              diff against the current file, or Cancel and edit again.
            </span>
            <button className="btn btn-small" onClick={() => void repreview()}>
              Re-preview
            </button>
          </div>
        )}
        <div className="modal-body">
          {preview.files.map((file) => (
            <section key={file.path} className="diff-file">
              <div className="diff-file-head">
                <code>{file.path}</code>
                {file.creates && <span className="pill pill-add">new file</span>}
                {file.deletes && <span className="pill pill-del">deleted</span>}
              </div>
              <pre className="diff">
                {file.diff.length === 0 && <span className="diff-ctx muted">(no textual change)</span>}
                {file.diff.map((line, i) => (
                  <span key={i} className={`diff-${line.type}`}>
                    {line.type === "add" ? "+ " : line.type === "del" ? "- " : line.type === "skip" ? "  " : "  "}
                    {line.text}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </section>
          ))}
        </div>
        <footer>
          <button className="btn" onClick={cancelPreview}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={preview.applying || !changed || preview.conflictPath !== undefined}
            onClick={() => void confirmApply()}
          >
            {preview.applying ? "Applying…" : "Apply"}
          </button>
        </footer>
      </div>
    </div>
  );
}
