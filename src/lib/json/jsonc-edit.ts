// Surgical JSON editing via jsonc-parser: only the targeted value's text range
// changes; every other byte of the file (key order, formatting, unrelated keys)
// is preserved. Critical for ~/.claude.json, which holds ~70 unrelated keys.

import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

export type JsonPathSegment = string | number;

export function parseJsonText(text: string | null): unknown {
  if (text === null || text.trim() === "") return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: false });
  if (errors.length > 0) {
    const first = errors[0] as ParseError;
    throw new Error(`invalid JSON at offset ${first.offset}: ${printParseErrorCode(first.error)}`);
  }
  return value;
}

export function setJsonValue(text: string | null, path: JsonPathSegment[], value: unknown): string {
  const base = text === null || text.trim() === "" ? "{}\n" : text;
  parseJsonText(base); // refuse to edit files we cannot parse
  const edits = modify(base, path, value, { formattingOptions: { ...FORMATTING } });
  return applyEdits(base, edits);
}

export function removeJsonKey(text: string | null, path: JsonPathSegment[]): string {
  const base = text === null || text.trim() === "" ? "{}\n" : text;
  parseJsonText(base);
  const edits = modify(base, path, undefined, { formattingOptions: { ...FORMATTING } });
  return applyEdits(base, edits);
}

export function isJsonParseable(text: string): boolean {
  const errors: ParseError[] = [];
  parse(text, errors);
  return errors.length === 0;
}
