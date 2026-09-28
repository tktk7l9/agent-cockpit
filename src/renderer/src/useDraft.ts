import { useCallback } from "react";
import { hasDraft, readDraftField } from "../../lib/drafts";
import { useStore } from "./store";

const EMPTY: Record<string, unknown> = {};

/**
 * useState that lives in the store's per-entity draft map, so the value survives
 * closing the editor or navigating elsewhere (SHIG 38). `initial` is the saved value.
 */
export function useDraft<T>(key: string, field: string, initial: T): [T, (value: T) => void] {
  // Select the stable draft object, not a derived value, so the snapshot stays referentially stable.
  const draft = useStore((s) => s.drafts[key] ?? EMPTY);
  const setDraftField = useStore((s) => s.setDraftField);
  const value = readDraftField({ [key]: draft }, key, field, initial);
  const set = useCallback((next: T) => setDraftField(key, field, next), [setDraftField, key, field]);
  return [value, set];
}

export function useHasDraft(key: string): boolean {
  return useStore((s) => hasDraft(s.drafts, key));
}
