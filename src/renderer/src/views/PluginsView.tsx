import type { PluginEntity } from "../../../lib/model/types";
import { AgentBadge, EmptyState, RevealButton, Switch } from "../components/ui";
import { entitiesFor, useStore } from "../store";

export function PluginsView(): React.JSX.Element {
  const data = useStore((s) => s.data);
  const agentFilter = useStore((s) => s.agentFilter);
  const requestPreview = useStore((s) => s.requestPreview);

  const entities = entitiesFor(data, "plugin", agentFilter);

  const toggle = (e: PluginEntity): void => {
    void requestPreview(
      {
        op: "togglePlugin",
        agent: e.agent === "claude" ? "claude" : "codex",
        filePath: e.filePath,
        key: e.key,
        enabled: !e.enabled,
      },
      { subject: e.key.split("@")[0] },
    );
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
                <Switch on={e.enabled} label={`Enable ${e.key.split("@")[0]}`} onToggle={() => toggle(e)} />
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
