import { useEffect } from "react";
import { EmptyState } from "../components/ui";
import { useStore } from "../store";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function BackupsView(): React.JSX.Element {
  const backups = useStore((s) => s.backups);
  const loadBackups = useStore((s) => s.loadBackups);
  const requestRestorePreview = useStore((s) => s.requestRestorePreview);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  return (
    <div className="single-pane">
      <div className="pane-head">
        <h1>Backups</h1>
        <button className="btn btn-small" onClick={() => void loadBackups()}>
          Refresh
        </button>
      </div>
      <p className="muted small pad-h">
        Every save first snapshots the original file here (last 50 per file). Restoring also goes through diff preview.
      </p>
      {backups.length === 0 && <EmptyState text="No backups yet — they appear after your first save." />}
      <table className="table">
        <thead>
          <tr>
            <th>File</th>
            <th>Taken</th>
            <th>Size</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => (
            <tr key={b.id}>
              <td className="mono ellipsis" title={b.sourcePath}>
                {b.sourcePath}
              </td>
              <td className="muted">{b.timestamp.replace(/T/, " ").replace(/-(\d+)Z?$/, ".$1")}</td>
              <td className="muted">{formatSize(b.size)}</td>
              <td>
                <button className="btn btn-small" onClick={() => void requestRestorePreview(b.id)}>
                  Restore…
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
