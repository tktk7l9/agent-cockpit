// Surgical TOML editing for ~/.codex/config.toml. Never re-serializes the whole
// document — every operation splices exact AST ranges (toml-eslint-parser), so
// comments and formatting outside the touched span survive byte-for-byte.

import { parseTOML, type AST } from "toml-eslint-parser";

function topLevel(text: string): AST.TOMLTopLevelTable {
  const program = parseTOML(text);
  return program.body[0] as AST.TOMLTopLevelTable;
}

function sameKey(a: (string | number)[], b: (string | number)[]): boolean {
  return a.length === b.length && a.every((seg, i) => String(seg) === String(b[i]));
}

function startsWithKey(key: (string | number)[], prefix: (string | number)[]): boolean {
  return key.length >= prefix.length && prefix.every((seg, i) => String(seg) === String(key[i]));
}

function kvPathOf(kv: AST.TOMLKeyValue): string[] {
  return kv.key.keys.map((k) => (k.type === "TOMLBare" ? k.name : String((k as unknown as { value: unknown }).value)));
}

function lineStart(text: string, offset: number): number {
  const nl = text.lastIndexOf("\n", offset - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** End offset extended past the trailing newline and any following blank lines. */
function consumeTrailingBlank(text: string, offset: number): number {
  let end = offset;
  if (text.startsWith("\r\n", end)) end += 2;
  else if (text.startsWith("\n", end)) end += 1;
  while (true) {
    const m = /^[ \t]*(\r?\n)/.exec(text.slice(end));
    if (!m) break;
    end += m[0].length;
  }
  return end;
}

// ---- value serialization ----

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

export function tomlKey(key: string): string {
  return BARE_KEY.test(key) ? key : tomlString(key);
}

export function tomlString(value: string): string {
  const escaped = value.replace(/[\\"\u0000-\u001f]/g, (ch) => {
    if (ch === "\\") return "\\\\";
    if (ch === '"') return '\\"';
    if (ch === "\n") return "\\n";
    if (ch === "\t") return "\\t";
    if (ch === "\r") return "\\r";
    return `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
  return `"${escaped}"`;
}

export function tomlValue(value: unknown): string {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => tomlValue(v)).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`);
    return `{ ${parts.join(", ")} }`;
  }
  throw new Error(`cannot serialize value as TOML: ${String(value)}`);
}

export function tomlHeader(keys: string[]): string {
  return `[${keys.map(tomlKey).join(".")}]`;
}

// ---- surgical operations ----

function findTable(top: AST.TOMLTopLevelTable, keys: string[]): AST.TOMLTable | undefined {
  for (const node of top.body) {
    if (node.type === "TOMLTable" && sameKey(node.resolvedKey as (string | number)[], keys)) return node;
  }
  return undefined;
}

function appendBlock(text: string, block: string): string {
  const trimmed = text.replace(/\n+$/, "");
  if (trimmed === "") return block.endsWith("\n") ? block : `${block}\n`;
  return `${trimmed}\n\n${block}${block.endsWith("\n") ? "" : "\n"}`;
}

/** Remove all tables whose resolved key starts with `prefix` (header + body). */
export function removeTables(text: string, prefix: string[]): string {
  const top = topLevel(text);
  const spans: [number, number][] = [];
  for (const node of top.body) {
    if (node.type === "TOMLTable" && startsWithKey(node.resolvedKey as (string | number)[], prefix)) {
      const start = lineStart(text, node.range[0]);
      const end = consumeTrailingBlank(text, node.range[1]);
      spans.push([start, end]);
    }
  }
  let out = text;
  for (const [start, end] of spans.reverse()) out = out.slice(0, start) + out.slice(end);
  return out;
}

/**
 * Replace (or create) the table block(s) for `prefix` with a freshly rendered
 * block. Comments inside the replaced block are lost; the rest of the file is
 * untouched. Used for MCP server upserts.
 */
export function upsertTableBlock(text: string, prefix: string[], block: string): string {
  const removed = removeTables(text, prefix);
  return appendBlock(removed, block);
}

/** Set one key inside a table (creating table or key as needed). */
export function setKeyInTable(text: string, tableKeys: string[], key: string, value: unknown): string {
  const top = topLevel(text);
  const table = findTable(top, tableKeys);
  if (!table) {
    return appendBlock(text, `${tomlHeader(tableKeys)}\n${tomlKey(key)} = ${tomlValue(value)}\n`);
  }
  const kv = table.body.find((n) => sameKey(kvPathOf(n), [key]));
  if (kv) {
    return text.slice(0, kv.value.range[0]) + tomlValue(value) + text.slice(kv.value.range[1]);
  }
  const insertAt = table.range[1];
  return `${text.slice(0, insertAt)}\n${tomlKey(key)} = ${tomlValue(value)}${text.slice(insertAt)}`;
}

/** Set a top-level (pre-table) key. New keys are inserted before the first table. */
export function setTopLevelKey(text: string, key: string, value: unknown): string {
  const top = topLevel(text);
  const kv = top.body.find((n): n is AST.TOMLKeyValue => n.type === "TOMLKeyValue" && sameKey(kvPathOf(n), [key]));
  if (kv) {
    return text.slice(0, kv.value.range[0]) + tomlValue(value) + text.slice(kv.value.range[1]);
  }
  const line = `${tomlKey(key)} = ${tomlValue(value)}\n`;
  const firstTable = top.body.find((n) => n.type === "TOMLTable");
  if (!firstTable) return appendBlock(text, line);
  const at = lineStart(text, firstTable.range[0]);
  return text.slice(0, at) + line + "\n" + text.slice(at);
}

/** Remove a single key from a table (line-level splice). */
export function removeKeyInTable(text: string, tableKeys: string[], key: string): string {
  const top = topLevel(text);
  const table = findTable(top, tableKeys);
  if (!table) return text;
  const kv = table.body.find((n) => sameKey(kvPathOf(n), [key]));
  if (!kv) return text;
  const start = lineStart(text, kv.range[0]);
  const end = consumeTrailingBlank(text, kv.range[1]);
  return text.slice(0, start) + text.slice(end);
}

/** Throws (with the parser's message) when the text is not valid TOML. */
export function assertValidToml(text: string): void {
  parseTOML(text);
}
