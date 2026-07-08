import { create } from "zustand";
import type { AgentId, Entity, EntityKind } from "../../lib/model/types";
import type { Mutation } from "../../lib/mutations";
import type { BackupInfo, PreviewFile, ScanResultPayload } from "../../shared/ipc";

export type Section = EntityKind | "projects" | "backups";

const SECTIONS: readonly Section[] = ["mcp", "skill", "subagent", "command", "plugin", "settings", "instructions", "projects", "backups"];
const AGENT_FILTERS: readonly (AgentId | "all")[] = ["all", "claude", "codex", "cursor", "shared"];
const UI_STATE_KEY = "ui-state";

function isValidSection(value: unknown): value is Section {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

function isValidAgentFilter(value: unknown): value is AgentId | "all" {
  return typeof value === "string" && (AGENT_FILTERS as readonly string[]).includes(value);
}

interface PersistedUiState {
  section?: unknown;
  agentFilter?: unknown;
}

function loadPersistedUiState(): PersistedUiState {
  try {
    return JSON.parse(localStorage.getItem(UI_STATE_KEY) ?? "{}") as PersistedUiState;
  } catch {
    return {};
  }
}

function saveUiState(section: Section, agentFilter: AgentId | "all"): void {
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({ section, agentFilter }));
  } catch {
    // localStorage unavailable — persistence is a nice-to-have, not required for the app to work
  }
}

export interface PreviewState {
  mutation: Mutation | null; // null = backup restore
  restoreId?: string;
  files: PreviewFile[];
  conflictPath?: string;
  applying: boolean;
}

interface CockpitState {
  data: ScanResultPayload | null;
  loading: boolean;
  section: Section;
  agentFilter: AgentId | "all";
  selectedId: string | null;
  creating: boolean;
  dirty: boolean;
  stale: boolean;
  preview: PreviewState | null;
  toast: { kind: "ok" | "err"; text: string } | null;
  backups: BackupInfo[];
  paletteOpen: boolean;

  refresh(): Promise<void>;
  setSection(section: Section): void;
  setAgentFilter(filter: AgentId | "all"): void;
  select(id: string | null): void;
  startCreate(): void;
  stopEditing(): void;
  setDirty(dirty: boolean): void;
  markStaleOrRefresh(): void;
  openPalette(): void;
  closePalette(): void;
  requestPreview(mutation: Mutation): Promise<void>;
  requestRestorePreview(id: string): Promise<void>;
  repreview(): Promise<void>;
  confirmApply(): Promise<void>;
  cancelPreview(): void;
  showToast(kind: "ok" | "err", text: string): void;
  loadBackups(): Promise<void>;
}

const persistedUiState = loadPersistedUiState();

export const useStore = create<CockpitState>((set, get) => ({
  data: null,
  loading: false,
  section: isValidSection(persistedUiState.section) ? persistedUiState.section : "mcp",
  agentFilter: isValidAgentFilter(persistedUiState.agentFilter) ? persistedUiState.agentFilter : "all",
  selectedId: null,
  creating: false,
  dirty: false,
  stale: false,
  preview: null,
  toast: null,
  backups: [],
  paletteOpen: false,

  refresh: async () => {
    set({ loading: true });
    const data = await window.cockpit.scan();
    set({ data, loading: false, stale: false });
  },

  setSection: (section) => {
    set({ section, selectedId: null, creating: false, dirty: false });
    saveUiState(section, get().agentFilter);
  },
  setAgentFilter: (agentFilter) => {
    set({ agentFilter });
    saveUiState(get().section, agentFilter);
  },
  select: (selectedId) => set({ selectedId, creating: false, dirty: false }),
  startCreate: () => set({ creating: true, selectedId: null, dirty: false }),
  stopEditing: () => set({ creating: false, selectedId: null, dirty: false }),
  setDirty: (dirty) => set({ dirty }),

  markStaleOrRefresh: () => {
    if (get().dirty || get().preview) set({ stale: true });
    else void get().refresh();
  },

  requestPreview: async (mutation) => {
    const result = await window.cockpit.preview(mutation);
    if (!result.ok) {
      get().showToast("err", result.error);
      return;
    }
    set({ preview: { mutation, files: result.files, applying: false } });
  },

  requestRestorePreview: async (id) => {
    const result = await window.cockpit.previewRestore(id);
    if (!result.ok) {
      get().showToast("err", result.error);
      return;
    }
    set({ preview: { mutation: null, restoreId: id, files: result.files, applying: false } });
  },

  repreview: async () => {
    const p = get().preview;
    if (!p) return;
    if (p.mutation) {
      const result = await window.cockpit.preview(p.mutation);
      if (!result.ok) {
        get().showToast("err", result.error);
        set({ preview: null });
        return;
      }
      set({ preview: { mutation: p.mutation, files: result.files, applying: false } });
      return;
    }
    if (p.restoreId) await get().requestRestorePreview(p.restoreId);
  },

  confirmApply: async () => {
    const preview = get().preview;
    if (!preview) return;
    set({ preview: { ...preview, applying: true } });
    const baseHashes = Object.fromEntries(preview.files.map((f) => [f.path, f.baseHash]));
    const result = preview.mutation
      ? await window.cockpit.apply(preview.mutation, baseHashes)
      : await window.cockpit.applyRestore(preview.restoreId as string, preview.files[0]?.baseHash ?? null);
    if (result.status === "ok") {
      set({ preview: null, dirty: false, creating: false });
      get().showToast("ok", "Saved");
      await get().refresh();
      if (!preview.mutation) await get().loadBackups();
    } else if (result.status === "conflict") {
      set({ preview: { ...preview, applying: false, conflictPath: result.path } });
    } else {
      set({ preview: { ...preview, applying: false } });
      get().showToast("err", result.message);
    }
  },

  cancelPreview: () => set({ preview: null }),

  showToast: (kind, text) => {
    set({ toast: { kind, text } });
    setTimeout(() => set({ toast: null }), 3500);
  },

  loadBackups: async () => {
    set({ backups: await window.cockpit.listBackups() });
  },

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
}));

export function entitiesFor(data: ScanResultPayload | null, kind: EntityKind, agentFilter: AgentId | "all"): Entity[] {
  if (!data) return [];
  return data.entities.filter((e) => e.kind === kind && (agentFilter === "all" || e.agent === agentFilter));
}
