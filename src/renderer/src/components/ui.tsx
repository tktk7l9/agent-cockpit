import { useId, type ReactNode } from "react";
import type { AgentId, Scope } from "../../../lib/model/types";
import { useStore } from "../store";
import { useHasDraft } from "../useDraft";

export const AGENT_LABEL: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  shared: "Shared",
};

export function AgentBadge({ agent }: { agent: AgentId }): React.JSX.Element {
  return <span className={`badge badge-${agent}`}>{AGENT_LABEL[agent]}</span>;
}

export function ScopeTag({ scope }: { scope: Scope }): React.JSX.Element {
  if (scope.level === "user") return <span className="tag">user</span>;
  const short = scope.projectPath.split("/").pop() ?? scope.projectPath;
  return (
    <span className="tag tag-project" title={scope.projectPath}>
      {short}
    </span>
  );
}

export function EmptyState({ text }: { text: string }): React.JSX.Element {
  return <div className="empty">{text}</div>;
}

export function RevealButton({ path }: { path: string }): React.JSX.Element {
  return (
    <button type="button" className="btn btn-small" onClick={() => void window.cockpit.reveal(path)} title={path}>
      Reveal in Finder
    </button>
  );
}

/** A labelled form field; the label is bound to the control through the id passed to `children` (SHIG 94/93). */
export function Field({
  label,
  className = "field",
  children,
}: {
  label: string;
  className?: string;
  children: (id: string) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

/** Text tag shown on list rows whose entity has unsaved input (SHIG 25/96: state in words, not only colour). */
export function UnsavedTag({ draftKey }: { draftKey: string }): React.JSX.Element | null {
  return useHasDraft(draftKey) ? <span className="tag tag-warn">unsaved</span> : null;
}

/** "Unsaved changes" + Discard (undoable) for the editor footer. */
export function DraftStatus({ draftKey }: { draftKey: string }): React.JSX.Element | null {
  const dirty = useHasDraft(draftKey);
  const discardDraft = useStore((s) => s.discardDraft);
  if (!dirty) return null;
  return (
    <>
      <span className="muted small">Unsaved changes</span>
      <button type="button" className="btn btn-small" onClick={() => discardDraft(draftKey)}>
        Discard changes
      </button>
    </>
  );
}

/** Keyboard-operable list row (SHIG 94/37): the whole row is one button. */
export function EntityRow({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <li className={selected ? "selected" : ""}>
      <button type="button" className="entity-row" aria-current={selected ? "true" : undefined} onClick={onSelect}>
        {children}
      </button>
    </li>
  );
}

/** On/off switch with an accessible name and a visible state word (SHIG 94/96). */
export function Switch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <span className="switch-wrap">
      <button type="button" className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={onToggle}>
        <span className="knob" />
      </button>
      <span className="muted small" aria-hidden="true">
        {on ? "On" : "Off"}
      </span>
    </span>
  );
}
