import type { AgentId, Scope } from "../../../lib/model/types";

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
