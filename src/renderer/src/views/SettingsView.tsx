import { useMemo } from "react";
import { claudePermissions } from "../../../lib/agents/claude";
import type { SettingsEntity } from "../../../lib/model/types";
import { LazyCodeEditor as CodeEditor } from "../components/LazyCodeEditor";
import { StringListEditor } from "../components/StringListEditor";
import { AgentBadge, DraftStatus, EmptyState, EntityRow, RevealButton, ScopeTag, UnsavedTag } from "../components/ui";
import { entitiesFor, useStore } from "../store";
import { useDraft } from "../useDraft";

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

  const entities = entitiesFor(data, "settings", agentFilter);
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
            <EntityRow key={e.id} selected={e.id === selectedId} onSelect={() => select(e.id)}>
              <div className="entity-row-top">
                <strong>{e.name}</strong>
                <AgentBadge agent={e.agent} />
                <ScopeTag scope={e.scope} />
                <UnsavedTag draftKey={e.id} />
              </div>
              <div className="entity-row-sub">
                <span className="muted mono ellipsis">{e.filePath}</span>
              </div>
            </EntityRow>
          ))}
        </ul>
      </div>
      {selected && <SettingsEditor key={selected.id} entity={selected} />}
    </div>
  );
}

// Each form on this screen saves on its own, so a save clears only its own draft fields
// and keeps unsaved input in the other forms (SHIG 38).
const PERMISSION_FIELDS = ["perm.mode", "perm.custom", "perm.allow", "perm.deny"];
const knownField = (settingKey: string): string => `known.${settingKey}`;

function knownText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function KnownSettingRow({ entity, settingKey }: { entity: SettingsEntity; settingKey: string }): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  const [value, setValue] = useDraft(entity.id, knownField(settingKey), knownText(entity.known[settingKey]));

  const save = (): void => {
    void requestPreview(
      {
        op: "setSetting",
        filePath: entity.filePath,
        format: entity.format,
        keyPath: entity.format === "json" ? settingKey.split(".") : [settingKey],
        value: parseInputValue(value),
      },
      { draftKey: entity.id, draftFields: [knownField(settingKey)], subject: settingKey },
    );
  };

  return (
    <div className="kv-row">
      <input value={settingKey} readOnly className="mono" aria-label="Setting key" />
      <input value={value} className="mono" aria-label={`Value of ${settingKey}`} onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn-small" onClick={save}>
        Set…
      </button>
    </div>
  );
}

function PermissionsSection({ entity }: { entity: SettingsEntity }): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  const key = entity.id;

  const initial = useMemo(() => claudePermissions(entity.rawText), [entity.rawText]);
  const initialOption =
    initial.defaultMode === undefined ? UNSET : KNOWN_MODES.includes(initial.defaultMode) ? initial.defaultMode : CUSTOM;

  const [modeOption, setModeOption] = useDraft(key, "perm.mode", initialOption);
  const [customMode, setCustomMode] = useDraft(key, "perm.custom", initialOption === CUSTOM ? (initial.defaultMode as string) : "");
  const [allow, setAllow] = useDraft<string[]>(key, "perm.allow", initial.allow);
  const [deny, setDeny] = useDraft<string[]>(key, "perm.deny", initial.deny);

  const save = (): void => {
    const defaultMode = modeOption === UNSET ? null : modeOption === CUSTOM ? customMode.trim() : modeOption;
    void requestPreview(
      {
        op: "setPermissions",
        filePath: entity.filePath,
        defaultMode,
        allow: allow.filter((a) => a.trim() !== ""),
        deny: deny.filter((d) => d.trim() !== ""),
      },
      { draftKey: key, draftFields: PERMISSION_FIELDS, subject: `${entity.name} permissions` },
    );
  };

  return (
    <div className="field">
      <label htmlFor={`${key}-mode`}>Permissions</label>
      <select id={`${key}-mode`} value={modeOption} onChange={(e) => setModeOption(e.target.value)}>
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
          aria-label="Custom defaultMode value"
          onChange={(e) => setCustomMode(e.target.value)}
        />
      )}
      <StringListEditor label="Allow rules" items={allow} onChange={setAllow} />
      <StringListEditor label="Deny rules" items={deny} onChange={setDeny} />
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
  const key = entity.id;

  const [raw, setRaw] = useDraft(key, "raw", entity.rawText);

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
          {Object.keys(entity.known).map((settingKey) => (
            <KnownSettingRow key={settingKey} entity={entity} settingKey={settingKey} />
          ))}
        </div>
      )}

      <div className="field grow">
        <label>Raw file ({entity.format})</label>
        <CodeEditor
          value={raw}
          lang={entity.format}
          minHeight="320px"
          onChange={setRaw}
        />
      </div>

      <div className="editor-actions">
        <span className="spacer" />
        <DraftStatus draftKey={key} />
        <button
          className="btn btn-primary"
          onClick={() =>
            void requestPreview(
              { op: "writeRaw", filePath: entity.filePath, format: entity.format, newText: raw },
              { draftKey: key, draftFields: ["raw"], subject: entity.name },
            )
          }
        >
          Save raw…
        </button>
      </div>
    </div>
  );
}
