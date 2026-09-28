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
