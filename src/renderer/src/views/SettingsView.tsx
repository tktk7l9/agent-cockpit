import { useMemo, useState } from "react";
import { claudePermissions } from "../../../lib/agents/claude";
import type { SettingsEntity } from "../../../lib/model/types";
import { LazyCodeEditor as CodeEditor } from "../components/LazyCodeEditor";
import { StringListEditor } from "../components/StringListEditor";
import { AgentBadge, EmptyState, RevealButton, ScopeTag } from "../components/ui";
import { entitiesFor, useStore } from "../store";

const KNOWN_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"];
const UNSET = "__unset__";
const CUSTOM = "__custom__";

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

function PermissionsSection({ entity }: { entity: SettingsEntity }): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  const setDirty = useStore((s) => s.setDirty);

  const initial = useMemo(() => claudePermissions(entity.rawText), [entity.rawText]);
  const initialOption =
    initial.defaultMode === undefined ? UNSET : KNOWN_MODES.includes(initial.defaultMode) ? initial.defaultMode : CUSTOM;

  const [modeOption, setModeOption] = useState(initialOption);
  const [customMode, setCustomMode] = useState(initialOption === CUSTOM ? (initial.defaultMode as string) : "");
  const [allow, setAllow] = useState<string[]>(initial.allow);
  const [deny, setDeny] = useState<string[]>(initial.deny);

  const save = (): void => {
    const defaultMode = modeOption === UNSET ? null : modeOption === CUSTOM ? customMode.trim() : modeOption;
    void requestPreview({
      op: "setPermissions",
      filePath: entity.filePath,
      defaultMode,
      allow: allow.filter((a) => a.trim() !== ""),
      deny: deny.filter((d) => d.trim() !== ""),
    });
  };

  return (
    <div className="field">
      <label>Permissions</label>
      <select
        value={modeOption}
        onChange={(e) => {
          setModeOption(e.target.value);
          setDirty(true);
        }}
      >
        <option value={UNSET}>(unset)</option>
        {KNOWN_MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={CUSTOM}>custom…</option>
      </select>
      {modeOption === CUSTOM && (
        <input
          value={customMode}
          className="mono"
          placeholder="custom defaultMode value"
          onChange={(e) => {
            setCustomMode(e.target.value);
            setDirty(true);
          }}
        />
      )}
      <StringListEditor
        label="Allow rules"
        items={allow}
        onChange={(v) => {
          setAllow(v);
          setDirty(true);
        }}
      />
      <StringListEditor
        label="Deny rules"
        items={deny}
        onChange={(v) => {
          setDeny(v);
          setDirty(true);
        }}
      />
      <div className="editor-actions">
        <span className="spacer" />
        <button className="btn btn-primary" onClick={save}>
          Save permissions…
        </button>
      </div>
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

      {entity.agent === "claude" && <PermissionsSection entity={entity} />}

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
