import { useMemo, useState } from "react";
import { draftKey } from "../../../lib/drafts";
import { mcpSecretValues, type McpInput } from "../../../lib/agents/mcp-common";
import type { ProbeResult } from "../../../lib/mcp-probe";
import type { McpServerEntity, McpTransport, ProjectInfo } from "../../../lib/model/types";
import type { McpTargetRef } from "../../../lib/mutations";
import { validateMcpInput } from "../../../lib/validate";
import { KvEditor } from "../components/KvEditor";
import { AgentBadge, DraftStatus, EmptyState, EntityRow, Field, RevealButton, ScopeTag, Switch, UnsavedTag } from "../components/ui";
import { entitiesFor, useStore } from "../store";
import { useDraft } from "../useDraft";

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

function ApprovalSwitch({
  home,
  projectPath,
  entity,
}: {
  home: string;
  projectPath: string;
  entity: McpServerEntity;
}): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  return (
    <div className="field">
      <label>Claude Code approval</label>
      <Switch
        on={entity.enabled === true}
        label={`Claude Code approval for ${entity.name}`}
        onToggle={() =>
          void requestPreview(
            {
              op: "toggleMcpJsonServer",
              claudeJsonPath: `${home}/.claude.json`,
              projectPath,
              name: entity.name,
              enabled: !(entity.enabled ?? false),
            },
            { subject: entity.name },
          )
        }
      />
      <p className="muted small">
        Stored in ~/.claude.json (projects.{"{path}"}). If enableAllProjectMcpServers is set there, it may take
        precedence over this per-server flag.
      </p>
    </div>
  );
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
            <EntityRow key={e.id} selected={e.id === selectedId} onSelect={() => select(e.id)}>
              <div className="entity-row-top">
                <strong>{e.name}</strong>
                <AgentBadge agent={e.agent} />
                <ScopeTag scope={e.scope} />
                {e.enabled === false && <span className="pill pill-del">disabled</span>}
                {e.enabled === undefined && e.source.kind === "mcpjson" && <span className="tag">unapproved</span>}
                <UnsavedTag draftKey={e.id} />
              </div>
              <div className="entity-row-sub">
                <span className="tag">{e.transport}</span>
                <span className="muted mono ellipsis">{summary(e)}</span>
              </div>
            </EntityRow>
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
  const key = draftKey("mcp", entity?.id);

  const options = useMemo(() => targetOptions(home, projects), [home, projects]);
  const [targetIndex, setTargetIndex] = useDraft(key, "targetIndex", 0);
  const target = entity ? targetOf(entity) : (options[Math.min(targetIndex, options.length - 1)] as TargetOption).target;

  const [name, setName] = useDraft(key, "name", entity?.name ?? "");
  const [transport, setTransport] = useDraft<McpTransport>(key, "transport", entity?.transport ?? "stdio");
  const [command, setCommand] = useDraft(key, "command", entity?.command ?? "");
  const [argsText, setArgsText] = useDraft(key, "args", (entity?.args ?? []).join("\n"));
  const [url, setUrl] = useDraft(key, "url", entity?.url ?? "");
  const [env, setEnv] = useDraft<[string, string][]>(key, "env", Object.entries(entity?.env ?? {}));
  const [headers, setHeaders] = useDraft<[string, string][]>(key, "headers", Object.entries(entity?.headers ?? {}));
  const [timeout, setTimeoutSec] = useDraft(key, "timeout", entity?.startupTimeoutSec?.toString() ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProbeResult | null>(null);

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
    void requestPreview({ op: "upsertMcp", target, prevName: entity?.name, input }, { draftKey: key, subject: input.name });
  };

  const remove = (): void => {
    if (!entity) return;
    void requestPreview({ op: "deleteMcp", target, name: entity.name }, { draftKey: key, subject: entity.name });
  };

  const runTest = async (): Promise<void> => {
    const input = buildInput();
    const problems = validateMcpInput(input);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await window.cockpit.mcpTest(input));
    } finally {
      setTesting(false);
    }
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
        <Field label="Write to">
          {(id) => (
            <select id={id} value={targetIndex} onChange={(e) => setTargetIndex(Number(e.target.value))}>
              {options.map((o, i) => (
                <option key={o.label} value={i}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {entity && (
        <p className="muted small">
          Source: <code>{entity.filePath}</code>
        </p>
      )}

      {entity && entity.source.kind === "mcpjson" && entity.scope.level === "project" ? (
        <ApprovalSwitch home={home} projectPath={entity.scope.projectPath} entity={entity} />
      ) : null}

      <Field label="Name">
        {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-server" />}
      </Field>

      <Field label="Transport">
        {(id) => (
          <select id={id} value={transport} onChange={(e) => setTransport(e.target.value as McpTransport)}>
            <option value="stdio">stdio (local command)</option>
            <option value="http">http (remote)</option>
            <option value="sse">sse (remote, legacy)</option>
          </select>
        )}
      </Field>

      {transport === "stdio" ? (
        <>
          <Field label="Command">
            {(id) => (
              <input id={id} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className="mono" />
            )}
          </Field>
          <Field label="Arguments (one per line)">
            {(id) => (
              <textarea
                id={id}
                value={argsText}
                rows={3}
                className="mono"
                onChange={(e) => setArgsText(e.target.value)}
                placeholder={"-y\n@scope/mcp-server"}
              />
            )}
          </Field>
          <KvEditor label="Environment variables" entries={env} onChange={setEnv} maskValues />
        </>
      ) : (
        <>
          <Field label="URL">
            {(id) => (
              <input id={id} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mono" />
            )}
          </Field>
          <KvEditor label="Headers" entries={headers} onChange={setHeaders} maskValues />
        </>
      )}

      {target.kind === "codex" && (
        <Field label="Startup timeout (sec)">
          {(id) => <input id={id} value={timeout} onChange={(e) => setTimeoutSec(e.target.value)} placeholder="10" />}
        </Field>
      )}

      {entity && Object.keys(entity.extras).length > 0 && (
        <div className="field">
          <label>Other keys (preserved as-is)</label>
          <pre className="extras">{JSON.stringify(entity.extras, null, 2)}</pre>
        </div>
      )}

      {errors.length > 0 && (
        <div className="banner banner-warn" role="alert">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {testResult && (
        <div className={`banner ${testResult.ok ? "banner-ok" : "banner-warn"}`}>
          {testResult.ok
            ? `✓ initialize OK — ${testResult.detail} (${testResult.elapsedMs}ms)`
            : `✗ ${testResult.phase}: ${testResult.detail} (${testResult.elapsedMs}ms)`}
        </div>
      )}

      <div className="editor-actions">
        {entity && !entity.readOnly && (
          <button className="btn btn-danger" onClick={remove}>
            Delete…
          </button>
        )}
        <span className="spacer" />
        <DraftStatus draftKey={key} />
        {mcpSecretValues(Object.fromEntries(env), Object.fromEntries(headers)).length > 0 && (
          <span className="muted small">env/header values are masked in the diff</span>
        )}
        <button className="btn btn-small" disabled={testing} onClick={() => void runTest()}>
          {testing ? "Testing…" : "Test"}
        </button>
        <button className="btn btn-primary" onClick={save}>
          Save…
        </button>
      </div>
    </div>
  );
}
