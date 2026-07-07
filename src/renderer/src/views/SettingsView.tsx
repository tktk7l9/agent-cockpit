import { useState } from "react";
import type { SettingsEntity } from "../../../lib/model/types";
import { CodeEditor } from "../components/CodeEditor";
import { AgentBadge, EmptyState, RevealButton, ScopeTag } from "../components/ui";
import { entitiesFor, useStore } from "../store";

function parseInputValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function SettingsView(): React.JSX.Element {
  const data = useStore((s) => s.data);
  const agentFilter = useStore((s) => s.agentFilter);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);

  const entities = entitiesFor(data, "settings", agentFilter) as SettingsEntity[];
  const selected = entities.find((e) => e.id === selectedId);

  return (
    <div className="split">
      <div className="list-pane">
        <div className="pane-head">
          <h1>Settings</h1>
        </div>
        {entities.length === 0 && <EmptyState text="No settings files found." />}
        <ul className="entity-list">
          {entities.map((e) => (
            <li key={e.id} className={e.id === selectedId ? "selected" : ""} onClick={() => select(e.id)}>
              <div className="entity-row-top">
                <strong>{e.name}</strong>
                <AgentBadge agent={e.agent} />
                <ScopeTag scope={e.scope} />
              </div>
              <div className="entity-row-sub">
                <span className="muted mono ellipsis">{e.filePath}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {selected && <SettingsEditor key={selected.id} entity={selected} />}
    </div>
  );
}

function SettingsEditor({ entity }: { entity: SettingsEntity }): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  const stopEditing = useStore((s) => s.stopEditing);
  const setDirty = useStore((s) => s.setDirty);

  const [raw, setRaw] = useState(entity.rawText);
  const [knownDrafts, setKnownDrafts] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(entity.known).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])),
  );

  const setKnown = (key: string): void => {
    const draft = knownDrafts[key] ?? "";
    void requestPreview({
      op: "setSetting",
      filePath: entity.filePath,
      format: entity.format,
      keyPath: entity.format === "json" ? key.split(".") : [key],
      value: parseInputValue(draft),
    });
  };

  return (
    <div className="editor-pane">
      <div className="pane-head">
        <h2>{entity.name}</h2>
        <div className="row-gap">
          <RevealButton path={entity.filePath} />
          <button className="btn btn-small" onClick={stopEditing}>
            Close
          </button>
        </div>
      </div>
      <p className="muted small">
        Source: <code>{entity.filePath}</code>
      </p>

      {Object.keys(entity.known).length > 0 && (
        <div className="field">
          <label>Quick edit</label>
          {Object.keys(entity.known).map((key) => (
            <div className="kv-row" key={key}>
              <input value={key} readOnly className="mono" />
              <input
                value={knownDrafts[key] ?? ""}
                className="mono"
                onChange={(e) => { setKnownDrafts({ ...knownDrafts, [key]: e.target.value }); setDirty(true); }}
              />
              <button className="btn btn-small" onClick={() => setKnown(key)}>
                Set…
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="field grow">
        <label>Raw file ({entity.format})</label>
        <CodeEditor
          value={raw}
          lang={entity.format}
          minHeight="320px"
          onChange={(v) => { setRaw(v); setDirty(true); }}
        />
      </div>

      <div className="editor-actions">
        <span className="spacer" />
        <button
          className="btn btn-primary"
          onClick={() => void requestPreview({ op: "writeRaw", filePath: entity.filePath, format: entity.format, newText: raw })}
        >
          Save raw…
        </button>
      </div>
    </div>
  );
}
