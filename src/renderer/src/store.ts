import { create } from "zustand";
import { clearDraft, clearDraftFields, hasDraft, openDraftKey, withDraftField, type Drafts } from "../../lib/drafts";
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

/** What the confirm button of the diff preview does — its label is this verb (SHIG 47). */
export type PreviewAction = "save" | "delete" | "restore";

export interface PreviewOptions {
  /** Draft cleared once the write succeeds (see lib/drafts). */
  draftKey?: string;
  /** Clear only these fields of the draft (the form that was saved); default clears the whole draft. */
  draftFields?: string[];
  /** Name shown in the preview title and the result toast. */
  subject?: string;
}

export interface Toast {
  kind: "ok" | "err";
  text: string;
  /** Optional one-click follow-up, e.g. Undo (SHIG 54/57). */
  action?: { label: string; run: () => void };
}

function actionOf(mutation: Mutation | null): PreviewAction {
  if (!mutation) return "restore";
  return mutation.op === "deleteMcp" || mutation.op === "deleteSkill" || mutation.op === "deleteFile" ? "delete" : "save";
}

const DONE_TEXT: Record<PreviewAction, string> = { save: "Saved", delete: "Deleted", restore: "Restored" };
const OK_TOAST_MS = 3500;
const UNDO_TOAST_MS = 8000;

export interface PreviewState {
  mutation: Mutation | null; // null = backup restore
  action: PreviewAction;
  options: PreviewOptions;
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
  /** Unsaved editor input per entity; survives navigation (SHIG 38). */
  drafts: Drafts;
  stale: boolean;
  preview: PreviewState | null;
  toast: Toast | null;
  backups: BackupInfo[];
  paletteOpen: boolean;
  errorsOpen: boolean;
  updateInfo: { current: string; latest: string; url: string } | null;

  refresh(): Promise<void>;
  setSection(section: Section): void;
  setAgentFilter(filter: AgentId | "all"): void;
  select(id: string | null): void;
  startCreate(): void;
  stopEditing(): void;
  setDraftField(key: string, field: string, value: unknown): void;
  discardDraft(key: string): void;
  reloadDiscardingDrafts(): Promise<void>;
  markStaleOrRefresh(): void;
  openPalette(): void;
  closePalette(): void;
  openErrors(): void;
  closeErrors(): void;
  checkUpdate(): Promise<void>;
  dismissUpdate(): void;
  requestPreview(mutation: Mutation, options?: PreviewOptions): Promise<void>;
  requestRestorePreview(id: string): Promise<void>;
  repreview(): Promise<void>;
  confirmApply(): Promise<void>;
  cancelPreview(): void;
  undoApply(token: number, done: string): Promise<void>;
  showToast(kind: "ok" | "err", text: string, action?: Toast["action"]): void;
  dismissToast(): void;
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
  drafts: {},
  stale: false,
  preview: null,
  toast: null,
  backups: [],
  paletteOpen: false,
  errorsOpen: false,
  updateInfo: null,

  refresh: async () => {
    set({ loading: true });
    const data = await window.cockpit.scan();
    set({ data, loading: false, stale: false });
  },

  setSection: (section) => {
    set({ section, selectedId: null, creating: false });
    saveUiState(section, get().agentFilter);
  },
  setAgentFilter: (agentFilter) => {
    set({ agentFilter });
    saveUiState(get().section, agentFilter);
  },
  // Navigation keeps drafts: reopening the entity brings the unsaved input back.
  select: (selectedId) => set({ selectedId, creating: false }),
  startCreate: () => set({ creating: true, selectedId: null }),
  stopEditing: () => set({ creating: false, selectedId: null }),
  setDraftField: (key, field, value) => set({ drafts: withDraftField(get().drafts, key, field, value) }),

  discardDraft: (key) => {
    const draft = get().drafts[key];
    if (!draft) return;
    set({ drafts: clearDraft(get().drafts, key) });
    get().showToast("ok", "Changes discarded", {
      label: "Undo",
      run: () => set({ drafts: { ...get().drafts, [key]: draft } }),
    });
  },

  // Discards only the draft of the editor on screen; drafts of other entities live in the
  // store and survive a rescan untouched.
  reloadDiscardingDrafts: async () => {
    const { selectedId, creating, section } = get();
    const key = openDraftKey(selectedId, creating, section);
    const draft = key === null ? undefined : get().drafts[key];
    if (key !== null) set({ drafts: clearDraft(get().drafts, key) });
    await get().refresh();
    if (key !== null && draft) {
      get().showToast("ok", "Reloaded from disk — draft discarded", {
        label: "Undo",
        run: () => set({ drafts: { ...get().drafts, [key]: draft } }),
      });
    }
  },

  // Only the editor on screen can be disrupted by a rescan, so a forgotten draft elsewhere
  // must not freeze auto-refresh.
  markStaleOrRefresh: () => {
    const { selectedId, creating, section, drafts, preview } = get();
    const key = openDraftKey(selectedId, creating, section);
    if (preview || (key !== null && hasDraft(drafts, key))) set({ stale: true });
    else void get().refresh();
  },

  requestPreview: async (mutation, options = {}) => {
    const result = await window.cockpit.preview(mutation);
    if (!result.ok) {
      get().showToast("err", result.error);
      return;
    }
    set({ preview: { mutation, action: actionOf(mutation), options, files: result.files, applying: false } });
  },

  requestRestorePreview: async (id) => {
    const result = await window.cockpit.previewRestore(id);
    if (!result.ok) {
      get().showToast("err", result.error);
      return;
    }
    set({
      preview: { mutation: null, action: "restore", options: {}, restoreId: id, files: result.files, applying: false },
    });
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
      set({ preview: { ...p, files: result.files, applying: false, conflictPath: undefined } });
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
      const { draftKey, draftFields } = preview.options;
      const done = DONE_TEXT[preview.action];
      const drafts = get().drafts;
      set({
        preview: null,
        creating: false,
        drafts: !draftKey
          ? drafts
          : draftFields
            ? clearDraftFields(drafts, draftKey, draftFields)
            : clearDraft(drafts, draftKey),
      });
      const token = result.undoToken;
      get().showToast(
        "ok",
        preview.options.subject ? `${done} ${preview.options.subject}` : done,
        token === undefined ? undefined : { label: "Undo", run: () => void get().undoApply(token, done) },
      );
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

  undoApply: async (token, done) => {
    set({ toast: null });
    const result = await window.cockpit.undoLastApply(token);
    if (result.status === "ok") {
      get().showToast("ok", `Undone — ${done.toLowerCase()} change reverted`);
      await get().refresh();
      if (get().section === "backups") await get().loadBackups();
    } else if (result.status === "conflict") {
      get().showToast("err", `Can't undo: ${result.path} changed after the save. Restore it from Backups instead.`);
    } else {
      get().showToast("err", result.message);
    }
  },

  // Success toasts fade on their own; errors stay until dismissed so they can be read (SHIG 55/97).
  showToast: (kind, text, action) => {
    const toast: Toast = { kind, text, action };
    set({ toast });
    if (kind === "ok") {
      setTimeout(() => {
        if (get().toast === toast) set({ toast: null });
      }, action ? UNDO_TOAST_MS : OK_TOAST_MS);
    }
  },
  dismissToast: () => set({ toast: null }),

  loadBackups: async () => {
    set({ backups: await window.cockpit.listBackups() });
  },

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  openErrors: () => set({ errorsOpen: true }),
  closeErrors: () => set({ errorsOpen: false }),

  checkUpdate: async () => {
    const result = await window.cockpit.checkUpdate();
    if (result.status === "update-available") {
      set({ updateInfo: { current: result.current, latest: result.latest, url: result.url } });
    } else if (result.status === "up-to-date") {
      set({ updateInfo: null });
      get().showToast("ok", `You're up to date (v${result.current})`);
    } else {
      set({ updateInfo: null });
      get().showToast("err", `Update check failed: ${result.message}`);
    }
  },
  dismissUpdate: () => set({ updateInfo: null }),
}));

export function entitiesFor<K extends EntityKind>(
  data: ScanResultPayload | null,
  kind: K,
  agentFilter: AgentId | "all",
): Extract<Entity, { kind: K }>[] {
  if (!data) return [];
  return data.entities.filter(
    (e): e is Extract<Entity, { kind: K }> => e.kind === kind && (agentFilter === "all" || e.agent === agentFilter),
  );
}
