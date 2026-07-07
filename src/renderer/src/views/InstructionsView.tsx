import { useState } from "react";
import type { InstructionsEntity } from "../../../lib/model/types";
import { CodeEditor } from "../components/CodeEditor";
import { AgentBadge, EmptyState, RevealButton, ScopeTag } from "../components/ui";
import { entitiesFor, useStore } from "../store";

export function InstructionsView(): React.JSX.Element {
  const data = useStore((s) => s.data);
  const agentFilter = useStore((s) => s.agentFilter);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);

  const entities = entitiesFor(data, "instructions", agentFilter) as InstructionsEntity[];
  const selected = entities.find((e) => e.id === selectedId);

  return (
    <div className="split">
      <div className="list-pane">
        <div className="pane-head">
          <h1>Instructions</h1>
        </div>
        <p className="muted small pad-h">AGENTS.md / CLAUDE.md instruction files, plus read-only Codex rules.</p>
        {entities.length === 0 && <EmptyState text="No instruction files found." />}
        <ul className="entity-list">
          {entities.map((e) => (
            <li key={e.id} className={e.id === selectedId ? "selected" : ""} onClick={() => select(e.id)}>
              <div className="entity-row-top">
                <strong>{e.name}</strong>
                <AgentBadge agent={e.agent} />
                <ScopeTag scope={e.scope} />
                {e.readOnly && <span className="tag">read-only</span>}
              </div>
              <div className="entity-row-sub">
                <span className="muted mono ellipsis">{e.filePath}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {selected && <InstructionsEditor key={selected.id} entity={selected} />}
    </div>
  );
}

function InstructionsEditor({ entity }: { entity: InstructionsEntity }): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  const stopEditing = useStore((s) => s.stopEditing);
  const setDirty = useStore((s) => s.setDirty);
  const [body, setBody] = useState(entity.body);

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
      <div className="field grow">
        <CodeEditor
          value={body}
          lang="markdown"
          readOnly={entity.readOnly}
          minHeight="400px"
          onChange={(v) => { setBody(v); setDirty(true); }}
        />
      </div>
      {!entity.readOnly && (
        <div className="editor-actions">
          <span className="spacer" />
          <button
            className="btn btn-primary"
            onClick={() => void requestPreview({ op: "writeRaw", filePath: entity.filePath, format: "markdown", newText: body })}
          >
            Save…
          </button>
        </div>
      )}
    </div>
  );
}
