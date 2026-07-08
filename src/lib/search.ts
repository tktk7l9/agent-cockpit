// Deterministic fuzzy search for the Cmd+K command palette. Pure: no DOM, no
// electron. Subsequence matching with bonuses for consecutive runs and
// word-boundary starts, so a literal substring always outranks a scattered
// match even when the scattered match hits more word boundaries.

import type { Entity } from "./model/types";

export interface SearchItem {
  id: string;
  label: string;
  sublabel?: string;
}

export interface SearchHit {
  item: SearchItem;
  score: number;
}

const WORD_BOUNDARY = new Set(["-", "_", ".", "/", " "]);
const CONSECUTIVE_BONUS = 5;
const BOUNDARY_BONUS = 2;
const SUBLABEL_PENALTY = 1000;

/**
 * Case-insensitive subsequence match. Returns null when the query does not
 * match at all (or is empty). Higher score = better match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query === "") return null;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let searchFrom = 0;
  let firstMatchIndex = -1;
  let prevMatchIndex = -1;
  let score = 0;

  for (const ch of q) {
    const idx = t.indexOf(ch, searchFrom);
    if (idx === -1) return null;
    if (firstMatchIndex === -1) firstMatchIndex = idx;
    score += 1;
    if (prevMatchIndex !== -1 && idx === prevMatchIndex + 1) score += CONSECUTIVE_BONUS;
    if (idx === 0 || WORD_BOUNDARY.has(t.charAt(idx - 1))) score += BOUNDARY_BONUS;
    prevMatchIndex = idx;
    searchFrom = idx + 1;
  }

  return score - firstMatchIndex * 0.1;
}

/**
 * Matches against label first, falling back to sublabel. Sublabel-only
 * matches are penalized so label matches always rank above them. Empty query
 * returns an empty array (callers show a fixed list instead).
 */
export function searchItems(query: string, items: SearchItem[], limit = 20): SearchHit[] {
  if (query.trim() === "") return [];
  const hits: SearchHit[] = [];
  for (const item of items) {
    const labelScore = fuzzyScore(query, item.label);
    if (labelScore !== null) {
      hits.push({ item, score: labelScore });
      continue;
    }
    const subScore = item.sublabel !== undefined ? fuzzyScore(query, item.sublabel) : null;
    if (subScore !== null) hits.push({ item, score: subScore - SUBLABEL_PENALTY });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Display name for any entity kind — PluginEntity has no `name`, only `key`. */
export function entityLabel(entity: Entity): string {
  return entity.kind === "plugin" ? entity.key : entity.name;
}

/** Secondary search text shown under the label, per entity kind. */
export function entitySublabel(entity: Entity): string | undefined {
  switch (entity.kind) {
    case "mcp":
      return entity.command ?? entity.url;
    case "skill":
    case "subagent":
    case "command":
      return entity.description;
    case "plugin":
      return entity.marketplace || undefined;
    case "settings":
    case "instructions":
      return entity.filePath;
  }
}
