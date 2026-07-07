// Shared list+editor view for skills, subagents and slash commands —
// all are markdown files with YAML frontmatter in well-known directories.

import { useMemo, useState } from "react";
import type {
  CommandEntity,
  Entity,
  ProjectInfo,
  SkillEntity,
  SubagentEntity,
} from "../../../lib/model/types";
import type { Mutation } from "../../../lib/mutations";
import { validateEntityName, validateSkillInput } from "../../../lib/validate";
import { CodeEditor } from "../components/CodeEditor";
import { AgentBadge, EmptyState, RevealButton, ScopeTag } from "../components/ui";
import { entitiesFor, useStore } from "../store";

type MdKind = "skill" | "subagent" | "command";
type MdEntity = SkillEntity | SubagentEntity | CommandEntity;

const TITLES: Record<MdKind, string> = { skill: "Skills", subagent: "Subagents", command: "Slash Commands" };

interface DirOption {
  label: string;
  dir: string;
}

function dirOptions(kind: MdKind, home: string, projects: ProjectInfo[]): DirOption[] {
  const out: DirOption[] = [];
  if (kind === "skill") {
    out.push(
      { label: "Claude Code — user (~/.claude/skills)", dir: `${home}/.claude/skills` },
      { label: "Codex — user (~/.codex/skills)", dir: `${home}/.codex/skills` },
      { label: "Cursor — user (~/.cursor/skills)", dir: `${home}/.cursor/skills` },
    );
  } else if (kind === "subagent") {
    out.push(
      { label: "Claude Code — user (~/.claude/agents)", dir: `${home}/.claude/agents` },
      { label: "Cursor — user (~/.cursor/agents)", dir: `${home}/.cursor/agents` },
    );
  } else {
    out.push({ label: "Claude Code — user (~/.claude/commands)", dir: `${home}/.claude/commands` });
  }
  for (const p of projects) {
    const short = p.path.split("/").pop() ?? p.path;
    const sub = kind === "skill" ? "skills" : kind === "subagent" ? "agents" : "commands";
    out.push({ label: `${short} — project (.claude/${sub})`, dir: `${p.path}/.claude/${sub}` });
  }
  return out;
}

/** Directory containing the entity, derived from its file path. */
function dirOf(kind: MdKind, entity: MdEntity, fallbackName: string): string {
  const parts = entity.filePath.split("/");
  // skill: <dir>/<name>/SKILL.md — command/subagent: <dir>/<name>.md
  const up = kind === "skill" ? 2 : 1;
  return parts.slice(0, parts.length - up).join("/") || `/${fallbackName}`;
}

function fileBaseName(entity: MdEntity): string {
  const parts = entity.filePath.split("/");
  const last = parts[parts.length - 1] ?? "";
  if (last === "SKILL.md") return parts[parts.length - 2] ?? entity.name;
  return last.replace(/\.md$/, "");
}

export function MarkdownEntityView({ kind }: { kind: MdKind }): React.JSX.Element {
  const data = useStore((s) => s.data);
  const agentFilter = useStore((s) => s.agentFilter);
  const selectedId = useStore((s) => s.selectedId);
  const creating = useStore((s) => s.creating);
  const select = useStore((s) => s.select);
  const startCreate = useStore((s) => s.startCreate);

  const entities = entitiesFor(data, kind, agentFilter) as MdEntity[];
  const selected = entities.find((e) => e.id === selectedId);

  return (
    <div className="split">
      <div className="list-pane">
        <div className="pane-head">
          <h1>{TITLES[kind]}</h1>
          <button className="btn btn-primary btn-small" onClick={startCreate}>
            + New
          </button>
        </div>
        {entities.length === 0 && <EmptyState text={`No ${TITLES[kind].toLowerCase()} found. Create one with “+ New”.`} />}
        <ul className="entity-list">
          {entities.map((e) => (
            <li key={e.id} className={e.id === selectedId ? "selected" : ""} onClick={() => select(e.id)}>
              <div className="entity-row-top">
                <strong>{e.name}</strong>
                <AgentBadge agent={e.agent} />
                <ScopeTag scope={e.scope} />
                {e.readOnly && <span className="tag">built-in</span>}
              </div>
              <div className="entity-row-sub">
                <span className="muted ellipsis">{"description" in e ? (e.description ?? "") : ""}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {(selected || creating) && data && (
        <MdEditor key={selected?.id ?? "new"} kind={kind} entity={selected} home={data.home} projects={data.projects} />
      )}
    </div>
  );
}

function MdEditor({
  kind,
  entity,
  home,
  projects,
}: {
  kind: MdKind;
  entity: MdEntity | undefined;
  home: string;
  projects: ProjectInfo[];
}): React.JSX.Element {
  const requestPreview = useStore((s) => s.requestPreview);
  const stopEditing = useStore((s) => s.stopEditing);
  const setDirty = useStore((s) => s.setDirty);

  const options = useMemo(() => dirOptions(kind, home, projects), [kind, home, projects]);
  const [dirIndex, setDirIndex] = useState(0);
  const dir = entity ? dirOf(kind, entity, entity.name) : (options[dirIndex] as DirOption).dir;
  const prevName = entity ? fileBaseName(entity) : undefined;

  const [name, setName] = useState(prevName ?? "");
  const [description, setDescription] = useState(
    entity && "description" in entity ? (entity.description ?? "") : "",
  );
  const [version, setVersion] = useState(entity && entity.kind === "skill" ? (entity.version ?? "") : "");
  const [tools, setTools] = useState(entity && entity.kind === "subagent" ? (entity.tools ?? "") : "");
  const [model, setModel] = useState(entity && entity.kind === "subagent" ? (entity.model ?? "") : "");
  const [body, setBody] = useState(entity?.body ?? "");
  const [errors, setErrors] = useState<string[]>([]);

  const readOnly = entity?.readOnly ?? false;

  const save = (): void => {
    const trimmed = name.trim();
    const problems = kind === "skill" ? validateSkillInput(trimmed, description) : validateEntityName(trimmed);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    let mutation: Mutation;
    if (kind === "skill") {
      mutation = {
        op: "upsertSkill",
        dir,
        name: trimmed,
        prevName,
        description: description.trim(),
        version: version.trim() === "" ? undefined : version.trim(),
        body,
      };
    } else {
      const frontmatter: Record<string, unknown> =
        kind === "subagent"
          ? {
              name: trimmed,
              description: description.trim(),
              tools: tools.trim() === "" ? undefined : tools.trim(),
              model: model.trim() === "" ? undefined : model.trim(),
            }
          : { description: description.trim() === "" ? undefined : description.trim() };
      mutation = { op: "upsertMarkdown", kind, dir, name: trimmed, prevName, frontmatter, body };
    }
    void requestPreview(mutation);
  };

  const remove = (): void => {
    if (!entity) return;
    if (entity.kind === "skill") {
      void requestPreview({ op: "deleteSkill", filePath: entity.filePath, skillDir: dirOf("skill", entity, entity.name) + `/${prevName ?? entity.name}` });
    } else {
      void requestPreview({ op: "deleteFile", filePath: entity.filePath });
    }
  };

  return (
    <div className="editor-pane">
      <div className="pane-head">
        <h2>{entity ? `${readOnly ? "View" : "Edit"}: ${entity.name}` : `New ${kind}`}</h2>
        <div className="row-gap">
          {entity && <RevealButton path={entity.filePath} />}
          <button className="btn btn-small" onClick={stopEditing}>
            Close
          </button>
        </div>
      </div>

      {!entity && (
        <div className="field">
          <label>Location</label>
          <select value={dirIndex} onChange={(e) => setDirIndex(Number(e.target.value))}>
            {options.map((o, i) => (
              <option key={o.dir} value={i}>
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
        <input value={name} readOnly={readOnly} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea
          rows={2}
          value={description}
          readOnly={readOnly}
          onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
        />
      </div>
      {kind === "skill" && (
        <div className="field">
          <label>Version (optional)</label>
          <input value={version} readOnly={readOnly} onChange={(e) => { setVersion(e.target.value); setDirty(true); }} />
        </div>
      )}
      {kind === "subagent" && (
        <>
          <div className="field">
            <label>Tools (comma-separated, optional)</label>
            <input value={tools} readOnly={readOnly} onChange={(e) => { setTools(e.target.value); setDirty(true); }} />
          </div>
          <div className="field">
            <label>Model (optional)</label>
            <input value={model} readOnly={readOnly} onChange={(e) => { setModel(e.target.value); setDirty(true); }} />
          </div>
        </>
      )}

      <div className="field grow">
        <label>Body (markdown)</label>
        <CodeEditor value={body} lang="markdown" readOnly={readOnly} minHeight="260px" onChange={(v) => { setBody(v); setDirty(true); }} />
      </div>

      {entity && Object.keys(("frontmatterExtras" in entity ? entity.frontmatterExtras : {}) ?? {}).length > 0 && (
        <div className="field">
          <label>Other frontmatter keys (preserved as-is)</label>
          <pre className="extras">{JSON.stringify(entity.frontmatterExtras, null, 2)}</pre>
        </div>
      )}

      {errors.length > 0 && (
        <div className="banner banner-warn">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="editor-actions">
          {entity && (
            <button className="btn btn-danger" onClick={remove}>
              Delete…
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-primary" onClick={save}>
            Save…
          </button>
        </div>
      )}
    </div>
  );
}
