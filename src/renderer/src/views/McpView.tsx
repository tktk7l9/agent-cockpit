import { useMemo, useState } from "react";
import { mcpSecretValues, type McpInput } from "../../../lib/agents/mcp-common";
import type { McpServerEntity, McpTransport, ProjectInfo } from "../../../lib/model/types";
import type { McpTargetRef } from "../../../lib/mutations";
import { validateMcpInput } from "../../../lib/validate";
import { KvEditor } from "../components/KvEditor";
import { AgentBadge, EmptyState, RevealButton, ScopeTag } from "../components/ui";
import { entitiesFor, useStore } from "../store";

interface TargetOption {
  label: string;
  target: McpTargetRef;
}

function targetOptions(home: string, projects: ProjectInfo[]): TargetOption[] {
  const out: TargetOption[] = [
    { label: "Claude Code — user (~/.claude.json)", target: { kind: "claude-user", filePath: `${home}/.claude.json` } },
    { label: "Codex — user (~/.codex/config.toml)", target: { kind: "codex", filePath: `${home}/.codex/config.toml` } },
    { label: "Cursor — user (~/.cursor/mcp.json)", target: { kind: "cursor", filePath: `${home}/.cursor/mcp.json` } },
  ];
  for (const p of projects) {
    const short = p.path.split("/").pop() ?? p.path;
    out.push({ label: `${short} — .mcp.json (repo-shared)`, target: { kind: "mcpjson", filePath: `${p.path}/.mcp.json` } });
    out.push({ label: `${short} — Cursor (.cursor/mcp.json)`, target: { kind: "cursor", filePath: `${p.path}/.cursor/mcp.json` } });
  }
  return out;
}

function targetOf(entity: McpServerEntity): McpTargetRef {
  const source = entity.source;
  if (source.kind === "claude-project") {
    return { kind: "claude-project", filePath: entity.filePath, projectPath: source.projectPath };
  }
  return { kind: source.kind, filePath: entity.filePath };
}

function summary(entity: McpServerEntity): string {
  if (entity.transport === "stdio") return [entity.command, ...(entity.args ?? [])].filter(Boolean).join(" ");
  return entity.url ?? "";
}

export function McpView(): React.JSX.Element {
  const data = useStore((s) => s.data);
  const agentFilter = useStore((s) => s.agentFilter);
  const selectedId = useStore((s) => s.selectedId);
  const creating = useStore((s) => s.creating);
  const select = useStore((s) => s.select);
  const startCreate = useStore((s) => s.startCreate);

  const entities = entitiesFor(data, "mcp", agentFilter) as McpServerEntity[];
  const selected = entities.find((e) => e.id === selectedId);

  return (
    <div className="split">
      <div className="list-pane">
        <div className="pane-head">
          <h1>MCP Servers</h1>
          <button className="btn btn-primary btn-small" onClick={startCreate}>
            + New
          </button>
        </div>
        {entities.length === 0 && <EmptyState text="No MCP servers found." />}
        <ul className="entity-list">
          {entities.map((e) => (
            <li key={e.id} className={e.id === selectedId ? "selected" : ""} onClick={() => select(e.id)}>
              <div className="entity-row-top">
                <strong>{e.name}</strong>
                <AgentBadge agent={e.agent} />
                <ScopeTag scope={e.scope} />
                {e.enabled === false && <span className="pill pill-del">disabled</span>}
              </div>
              <div className="entity-row-sub">
                <span className="tag">{e.transport}</span>
                <span className="muted mono ellipsis">{summary(e)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {(selected || creating) && data && (
        <McpEditor key={selected?.id ?? "new"} entity={selected} home={data.home} projects={data.projects} />
      )}
    </div>
  );
}

function McpEditor({
  entity,
  home,
  projects,
}: {
  entity: McpServerEntity | undefined;
  home: string;
  projects: ProjectInfo[];
}): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  const stopEditing = useStore((s) => s.stopEditing);
  const setDirty = useStore((s) => s.setDirty);

  const options = useMemo(() => targetOptions(home, projects), [home, projects]);
  const [targetIndex, setTargetIndex] = useState(0);
  const target = entity ? targetOf(entity) : (options[targetIndex] as TargetOption).target;

  const [name, setName] = useState(entity?.name ?? "");
  const [transport, setTransport] = useState<McpTransport>(entity?.transport ?? "stdio");
  const [command, setCommand] = useState(entity?.command ?? "");
  const [argsText, setArgsText] = useState((entity?.args ?? []).join("\n"));
  const [url, setUrl] = useState(entity?.url ?? "");
  const [env, setEnv] = useState<[string, string][]>(Object.entries(entity?.env ?? {}));
  const [headers, setHeaders] = useState<[string, string][]>(Object.entries(entity?.headers ?? {}));
  const [timeout, setTimeoutSec] = useState(entity?.startupTimeoutSec?.toString() ?? "");
  const [errors, setErrors] = useState<string[]>([]);

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const buildInput = (): McpInput => ({
    name: name.trim(),
    transport,
    command: transport === "stdio" ? command.trim() : undefined,
    args:
      transport === "stdio"
        ? argsText
            .split("\n")
            .map((a) => a.trim())
            .filter((a) => a !== "")
        : undefined,
    env: transport === "stdio" ? Object.fromEntries(env.filter(([k]) => k.trim() !== "")) : undefined,
    url: transport !== "stdio" ? url.trim() : undefined,
    headers: transport !== "stdio" ? Object.fromEntries(headers.filter(([k]) => k.trim() !== "")) : undefined,
    startupTimeoutSec: target.kind === "codex" && timeout !== "" ? Number(timeout) : undefined,
    extras: entity?.extras ?? {},
  });

  const save = (): void => {
    const input = buildInput();
    const problems = validateMcpInput(input);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    void requestPreview({ op: "upsertMcp", target, prevName: entity?.name, input });
  };

  const remove = (): void => {
    if (!entity) return;
    void requestPreview({ op: "deleteMcp", target, name: entity.name });
  };

  return (
    <div className="editor-pane">
      <div className="pane-head">
        <h2>{entity ? `Edit: ${entity.name}` : "New MCP server"}</h2>
        <div className="row-gap">
          {entity && <RevealButton path={entity.filePath} />}
          <button className="btn btn-small" onClick={stopEditing}>
            Close
          </button>
        </div>
      </div>

      {!entity && (
        <div className="field">
          <label>Write to</label>
          <select value={targetIndex} onChange={(e) => setTargetIndex(Number(e.target.value))}>
            {options.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {entity && (
        <p className="muted small">
          Source: <code>{entity.filePath}</code>
        </p>
      )}

      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => touch(setName)(e.target.value)} placeholder="my-server" />
      </div>

      <div className="field">
        <label>Transport</label>
        <select value={transport} onChange={(e) => touch(setTransport)(e.target.value as McpTransport)}>
          <option value="stdio">stdio (local command)</option>
          <option value="http">http (remote)</option>
          <option value="sse">sse (remote, legacy)</option>
        </select>
      </div>

      {transport === "stdio" ? (
        <>
          <div className="field">
            <label>Command</label>
            <input value={command} onChange={(e) => touch(setCommand)(e.target.value)} placeholder="npx" className="mono" />
          </div>
          <div className="field">
            <label>Arguments (one per line)</label>
            <textarea
              value={argsText}
              rows={3}
              className="mono"
              onChange={(e) => touch(setArgsText)(e.target.value)}
              placeholder={"-y\n@scope/mcp-server"}
            />
          </div>
          <KvEditor label="Environment variables" entries={env} onChange={touch(setEnv)} maskValues />
        </>
      ) : (
        <>
          <div className="field">
            <label>URL</label>
            <input value={url} onChange={(e) => touch(setUrl)(e.target.value)} placeholder="https://…" className="mono" />
          </div>
          <KvEditor label="Headers" entries={headers} onChange={touch(setHeaders)} maskValues />
        </>
      )}

      {target.kind === "codex" && (
        <div className="field">
          <label>Startup timeout (sec)</label>
          <input value={timeout} onChange={(e) => touch(setTimeoutSec)(e.target.value)} placeholder="10" />
        </div>
      )}

      {entity && Object.keys(entity.extras).length > 0 && (
        <div className="field">
          <label>Other keys (preserved as-is)</label>
          <pre className="extras">{JSON.stringify(entity.extras, null, 2)}</pre>
        </div>
      )}

      {errors.length > 0 && (
        <div className="banner banner-warn">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      <div className="editor-actions">
        {entity && !entity.readOnly && (
          <button className="btn btn-danger" onClick={remove}>
            Delete…
          </button>
        )}
        <span className="spacer" />
        {mcpSecretValues(Object.fromEntries(env), Object.fromEntries(headers)).length > 0 && (
          <span className="muted small">env/header values are masked in the diff</span>
        )}
        <button className="btn btn-primary" onClick={save}>
          Save…
        </button>
      </div>
    </div>
  );
}
