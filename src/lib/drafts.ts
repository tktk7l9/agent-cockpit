// Unsaved editor state, kept per entity so navigating away never throws the
// user's input away (SHIG 38: what the user typed belongs to the user).

import type { EntityKind } from "./model/types";

export type Drafts = Record<string, Record<string, unknown>>;

export function draftKey(kind: EntityKind, entityId: string | undefined): string {
  return entityId ?? `new:${kind}`;
}

export function withDraftField(drafts: Drafts, key: string, field: string, value: unknown): Drafts {
  return { ...drafts, [key]: { ...drafts[key], [field]: value } };
}

export function readDraftField<T>(drafts: Drafts, key: string, field: string, fallback: T): T {
  const draft = drafts[key];
  if (!draft || !Object.prototype.hasOwnProperty.call(draft, field)) return fallback;
  return draft[field] as T;
}

export function hasDraft(drafts: Drafts, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(drafts, key);
}

export function clearDraft(drafts: Drafts, key: string): Drafts {
  if (!hasDraft(drafts, key)) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}

/**
 * Clears only the given fields of one draft (a file edited through several
 * independent forms, e.g. settings permissions vs. raw text, saves one form at a
 * time and must keep the others' unsaved input). Drops the draft once empty.
 */
export function clearDraftFields(drafts: Drafts, key: string, fields: readonly string[]): Drafts {
  const draft = drafts[key];
  if (!draft) return drafts;
  const rest = Object.fromEntries(Object.entries(draft).filter(([field]) => !fields.includes(field)));
  if (Object.keys(rest).length === 0) return clearDraft(drafts, key);
  return { ...drafts, [key]: rest };
}

/** Draft key of the editor currently on screen, or null when no editor is open. */
export function openDraftKey(selectedId: string | null, creating: boolean, section: string): string | null {
  if (selectedId !== null) return selectedId;
  return creating ? `new:${section}` : null;
}
