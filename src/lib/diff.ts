// Structured line diff for the save-preview modal.

import { diffLines } from "diff";
import { maskValues } from "./redact";

export interface DiffLine {
  type: "ctx" | "add" | "del" | "skip";
  text: string;
}

function toLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function buildDiffLines(oldText: string | null, newText: string | null, context = 3): DiffLine[] {
  const parts = diffLines(oldText ?? "", newText ?? "");
  const all: DiffLine[] = [];
  for (const part of parts) {
    const type: DiffLine["type"] = part.added ? "add" : part.removed ? "del" : "ctx";
    for (const line of toLines(part.value)) all.push({ type, text: line });
  }
  const out: DiffLine[] = [];
  let i = 0;
  while (i < all.length) {
    const line = all[i] as DiffLine;
    if (line.type !== "ctx") {
      out.push(line);
      i += 1;
      continue;
    }
    let j = i;
    while (j < all.length && (all[j] as DiffLine).type === "ctx") j += 1;
    const runLength = j - i;
    const keepHead = i === 0 ? 0 : context; // no context needed at file edges
    const keepTail = j === all.length ? 0 : context;
    if (runLength > keepHead + keepTail + 1) {
      out.push(...all.slice(i, i + keepHead));
      out.push({ type: "skip", text: `… ${runLength - keepHead - keepTail} unchanged lines` });
      out.push(...all.slice(j - keepTail, j));
    } else {
      out.push(...all.slice(i, j));
    }
    i = j;
  }
  return out;
}

export function maskDiff(lines: DiffLine[], secretValues: string[]): DiffLine[] {
  if (secretValues.length === 0) return lines;
  return lines.map((l) => ({ ...l, text: maskValues(l.text, secretValues) }));
}
