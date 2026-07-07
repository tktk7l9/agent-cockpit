import type { PluginEntity } from "../../../lib/model/types";
import { AgentBadge, EmptyState, RevealButton } from "../components/ui";
import { entitiesFor, useStore } from "../store";

export function PluginsView(): React.JSX.Element {
  const data = useStore((s) => s.data);
  const agentFilter = useStore((s) => s.agentFilter);
  const requestPreview = useStore((s) => s.requestPreview);

  const entities = entitiesFor(data, "plugin", agentFilter) as PluginEntity[];

  const toggle = (e: PluginEntity): void => {
    void requestPreview({
      op: "togglePlugin",
      agent: e.agent === "claude" ? "claude" : "codex",
      filePath: e.filePath,
      key: e.key,
      enabled: !e.enabled,
    });
  };

  return (
    <div className="single-pane">
      <div className="pane-head">
        <h1>Plugins</h1>
      </div>
      {entities.length === 0 && <EmptyState text="No plugins found." />}
      <table className="table">
        <thead>
          <tr>
            <th>Plugin</th>
            <th>Agent</th>
            <th>Marketplace</th>
            <th>Version</th>
            <th>Enabled</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <tr key={e.id}>
              <td className="mono">{e.key.split("@")[0]}</td>
              <td>
                <AgentBadge agent={e.agent} />
              </td>
              <td className="muted">{e.marketplace}</td>
              <td className="muted">{e.version ?? "—"}</td>
              <td>
                <button
                  className={`switch ${e.enabled ? "on" : ""}`}
                  role="switch"
                  aria-checked={e.enabled}
                  onClick={() => toggle(e)}
                >
                  <span className="knob" />
                </button>
              </td>
              <td>
                <RevealButton path={e.filePath} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
