import { EmptyState, RevealButton } from "../components/ui";
import { useStore } from "../store";

export function ProjectsView(): React.JSX.Element {
  const data = useStore((s) => s.data);
  const showToast = useStore((s) => s.showToast);

  const addProject = async (): Promise<void> => {
    const result = await window.cockpit.addProject();
    if (result) {
      useStore.setState({ data: result });
      showToast("ok", "Project added");
    }
  };

  const removeProject = async (path: string): Promise<void> => {
    const result = await window.cockpit.removeProject(path);
    useStore.setState({ data: result });
  };

  const projects = data?.projects ?? [];

  return (
    <div className="single-pane">
      <div className="pane-head">
        <h1>Projects</h1>
        <button className="btn btn-primary btn-small" onClick={() => void addProject()}>
          + Add folder…
        </button>
      </div>
      <p className="muted small pad-h">
        Projects are discovered from Claude Code and Codex state, filtered to folders that still exist and contain
        agent config. Project-scope entities (`.mcp.json`, `.claude/…`) are scanned for these folders.
      </p>
      {projects.length === 0 && <EmptyState text="No projects discovered yet." />}
      <table className="table">
        <thead>
          <tr>
            <th>Path</th>
            <th>Discovered via</th>
            <th>Codex trust</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.path}>
              <td className="mono">{p.path}</td>
              <td className="muted">{p.sources.join(", ")}</td>
              <td className="muted">{p.codexTrustLevel ?? "—"}</td>
              <td className="row-gap">
                <RevealButton path={p.path} />
                {p.sources.includes("manual") && (
                  <button className="btn btn-small" onClick={() => void removeProject(p.path)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
