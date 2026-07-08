import { useEffect, useMemo, useRef, useState } from "react";
import type { Entity } from "../../../lib/model/types";
import { entityLabel, entitySublabel, searchItems, type SearchHit, type SearchItem } from "../../../lib/search";
import { useStore, type Section } from "../store";
import { AgentBadge, ScopeTag } from "./ui";

const SECTION_ACTIONS: { section: Section; label: string }[] = [
  { section: "mcp", label: "Go to MCP Servers" },
  { section: "skill", label: "Go to Skills" },
  { section: "subagent", label: "Go to Subagents" },
  { section: "command", label: "Go to Commands" },
  { section: "plugin", label: "Go to Plugins" },
  { section: "settings", label: "Go to Settings" },
  { section: "instructions", label: "Go to Instructions" },
  { section: "projects", label: "Go to Projects" },
  { section: "backups", label: "Go to Backups" },
];

const ADD_PROJECT_ID = "action:add-project";
const SECTION_PREFIX = "action:section:";

const KIND_ICON: Record<Entity["kind"], string> = {
  mcp: "⚡",
  skill: "◆",
  subagent: "🤖",
  command: "/",
  plugin: "🔌",
  settings: "⚙",
  instructions: "📋",
};

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen);
  const close = useStore((s) => s.closePalette);
  const data = useStore((s) => s.data);
  const setSection = useStore((s) => s.setSection);
  const select = useStore((s) => s.select);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entityMap = useMemo(() => new Map((data?.entities ?? []).map((e) => [e.id, e] as const)), [data]);

  const actionItems: SearchItem[] = useMemo(
    () => [
      ...SECTION_ACTIONS.map((a) => ({ id: `${SECTION_PREFIX}${a.section}`, label: a.label })),
      { id: ADD_PROJECT_ID, label: "Add project folder…" },
    ],
    [],
  );

  const allItems: SearchItem[] = useMemo(() => {
    const entityItems: SearchItem[] = (data?.entities ?? []).map((e) => ({
      id: e.id,
      label: entityLabel(e),
      sublabel: entitySublabel(e),
    }));
    return [...actionItems, ...entityItems];
  }, [actionItems, data]);

  const displayed: SearchHit[] = useMemo(() => {
    if (query.trim() === "") return actionItems.map((item) => ({ item, score: 0 }));
    return searchItems(query, allItems, 20);
  }, [query, actionItems, allItems]);

  useEffect(() => {
    setActiveIndex(0);
  }, [displayed]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setActiveIndex(0);
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const runItem = (id: string): void => {
    if (id === ADD_PROJECT_ID) {
      close();
      void window.cockpit.addProject().then((result) => {
        if (result) useStore.setState({ data: result });
      });
      return;
    }
    if (id.startsWith(SECTION_PREFIX)) {
      setSection(id.slice(SECTION_PREFIX.length) as Section);
      close();
      return;
    }
    const entity = entityMap.get(id);
    if (entity) {
      setSection(entity.kind);
      select(entity.id);
      close();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, displayed.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = displayed[activeIndex];
      if (hit) runItem(hit.item.id);
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search MCP servers, skills, subagents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list">
          {displayed.map((hit, i) => {
            const entity = entityMap.get(hit.item.id);
            return (
              <li
                key={hit.item.id}
                className={i === activeIndex ? "active" : ""}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => runItem(hit.item.id)}
              >
                <span className="palette-icon">{entity ? KIND_ICON[entity.kind] : "→"}</span>
                <span className="palette-label">{hit.item.label}</span>
                {entity && <AgentBadge agent={entity.agent} />}
                {entity && <ScopeTag scope={entity.scope} />}
              </li>
            );
          })}
          {query.trim() !== "" && displayed.length === 0 && <li className="palette-empty muted">No results</li>}
        </ul>
      </div>
    </div>
  );
}
