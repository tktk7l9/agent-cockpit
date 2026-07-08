import { useEffect } from "react";
import type { AgentId, EntityKind } from "../../lib/model/types";
import { CommandPalette } from "./components/CommandPalette";
import { DiffModal } from "./components/DiffModal";
import { AGENT_LABEL } from "./components/ui";
import { entitiesFor, useStore, type Section } from "./store";
import { BackupsView } from "./views/BackupsView";
import { InstructionsView } from "./views/InstructionsView";
import { MarkdownEntityView } from "./views/MarkdownEntityView";
import { McpView } from "./views/McpView";
import { PluginsView } from "./views/PluginsView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsView } from "./views/SettingsView";

const SECTIONS: { key: Section; label: string; kind?: EntityKind }[] = [
  { key: "mcp", label: "MCP Servers", kind: "mcp" },
  { key: "skill", label: "Skills", kind: "skill" },
  { key: "subagent", label: "Subagents", kind: "subagent" },
  { key: "command", label: "Commands", kind: "command" },
  { key: "plugin", label: "Plugins", kind: "plugin" },
  { key: "settings", label: "Settings", kind: "settings" },
  { key: "instructions", label: "Instructions", kind: "instructions" },
  { key: "projects", label: "Projects" },
  { key: "backups", label: "Backups" },
];

const AGENTS: (AgentId | "all")[] = ["all", "claude", "codex", "cursor"];

export function App(): React.JSX.Element {
  const data = useStore((s) => s.data);
  const loading = useStore((s) => s.loading);
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const agentFilter = useStore((s) => s.agentFilter);
  const setAgentFilter = useStore((s) => s.setAgentFilter);
  const stale = useStore((s) => s.stale);
  const refresh = useStore((s) => s.refresh);
  const markStaleOrRefresh = useStore((s) => s.markStaleOrRefresh);
  const toast = useStore((s) => s.toast);
  const openPalette = useStore((s) => s.openPalette);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.cockpit.onChanged(() => markStaleOrRefresh());
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPalette]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="drag-region" />
        <div className="brand">
          <span className="brand-mark">⌘</span> Agent Cockpit
        </div>
        <nav>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`nav-item ${section === s.key ? "active" : ""}`}
              onClick={() => setSection(s.key)}
            >
              <span>{s.label}</span>
              {s.kind && data && <span className="count">{entitiesFor(data, s.kind, agentFilter).length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="agent-filter">
            {AGENTS.map((a) => (
              <button
                key={a}
                className={`chip chip-${a} ${agentFilter === a ? "active" : ""}`}
                onClick={() => setAgentFilter(a)}
              >
                {a === "all" ? "All" : AGENT_LABEL[a]}
              </button>
            ))}
          </div>
          {data && data.errors.length > 0 && (
            <div className="scan-errors" title={data.errors.map((e) => `${e.path}: ${e.message}`).join("\n")}>
              ⚠ {data.errors.length} file(s) could not be parsed
            </div>
          )}
        </div>
      </aside>

      <main className="content">
        {stale && (
          <div className="banner banner-warn banner-top">
            Config files changed on disk. Your draft is still intact — you can keep editing and Save… (the diff
            preview always compares against the current file).
            <button className="btn btn-small" onClick={() => void refresh()}>
              Reload (discard draft)
            </button>
          </div>
        )}
        {loading && !data ? (
          <div className="empty">Scanning agent configuration…</div>
        ) : (
          <>
            {section === "mcp" && <McpView />}
            {section === "skill" && <MarkdownEntityView kind="skill" key="skill" />}
            {section === "subagent" && <MarkdownEntityView kind="subagent" key="subagent" />}
            {section === "command" && <MarkdownEntityView kind="command" key="command" />}
            {section === "plugin" && <PluginsView />}
            {section === "settings" && <SettingsView />}
            {section === "instructions" && <InstructionsView />}
            {section === "projects" && <ProjectsView />}
            {section === "backups" && <BackupsView />}
          </>
        )}
      </main>

      <DiffModal />
      <CommandPalette />
      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
