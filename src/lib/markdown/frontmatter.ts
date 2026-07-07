// SKILL.md / subagent / command markdown files: YAML frontmatter + verbatim body.
// Frontmatter edits go through the yaml Document API so YAML comments survive.

import { parseDocument, Document } from "yaml";

export interface FrontmatterDoc {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
  /** Raw YAML text between the fences (without them), "" when absent. */
  yamlText: string;
}

const OPEN = "---\n";

function splitFences(text: string): { yamlText: string; body: string } | null {
  if (!text.startsWith(OPEN)) return null;
  const rest = text.slice(OPEN.length);
  const close = rest.match(/^---[ \t]*(\r?\n|$)/m);
  if (!close || close.index === undefined) return null;
  const yamlText = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  return { yamlText, body };
}

export function parseFrontmatter(text: string): FrontmatterDoc {
  const split = splitFences(text);
  if (!split) return { data: {}, body: text, hasFrontmatter: false, yamlText: "" };
  const doc = parseDocument(split.yamlText);
  const parsed = doc.toJS() as unknown;
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { data, body: split.body, hasFrontmatter: true, yamlText: split.yamlText };
}

/**
 * Update frontmatter keys in place (comment-preserving). `undefined` deletes a key.
 * The body is never touched. Files without frontmatter get one prepended.
 */
export function updateFrontmatter(text: string, updates: Record<string, unknown>): string {
  const split = splitFences(text);
  const doc = split ? parseDocument(split.yamlText) : new Document({});
  if (doc.contents === null || doc.contents === undefined) doc.contents = doc.createNode({});
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) doc.delete(key);
    else doc.set(key, value);
  }
  // don't prepend an empty "{}" frontmatter to a plain markdown file
  const remaining = doc.toJS() as unknown;
  const isEmpty = remaining === null || (typeof remaining === "object" && Object.keys(remaining as object).length === 0);
  if (!split && isEmpty) return text;
  const yamlBlock = String(doc); // yaml always newline-terminates its output
  const body = split ? split.body : text;
  return `---\n${yamlBlock}---\n${body}`;
}

/** Build a fresh markdown file with frontmatter (new skills/subagents/commands). */
export function buildFrontmatterFile(data: Record<string, unknown>, body: string): string {
  const yamlBlock = String(new Document(data)); // yaml always newline-terminates its output
  const normalizedBody = body === "" || body.endsWith("\n") ? body : `${body}\n`;
  return `---\n${yamlBlock}---\n\n${normalizedBody}`;
}
