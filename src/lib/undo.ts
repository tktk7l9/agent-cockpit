// Undo for the most recent apply (SHIG 54/57: act without asking, then offer a
// fail-safe way back). Main records each touched file's text before the write
// and the hash of what it wrote; undo writes the old text back only if the file
// still holds exactly what we wrote, so later edits are never clobbered.

import type { FileEdit } from "./model/types";

export interface AppliedFile {
  path: string;
  /** Text before the apply; null = the apply created this file. */
  prevText: string | null;
  /** sha256 of what the apply left on disk; null = the apply deleted this file. */
  writtenHash: string | null;
}

export interface UndoPlan {
  edits: FileEdit[];
  baseHashes: Record<string, string | null>;
}

function parentDir(filePath: string): string {
  const dir = filePath.slice(0, filePath.lastIndexOf("/"));
  return dir === "" ? "/" : dir;
}

export function planUndo(applied: AppliedFile[]): UndoPlan {
  const edits: FileEdit[] = [];
  const baseHashes: Record<string, string | null> = {};
  for (const file of applied) {
    edits.push(
      file.prevText === null
        ? { path: file.path, newText: null }
        : { path: file.path, newText: file.prevText, createDirs: [parentDir(file.path)] },
    );
    baseHashes[file.path] = file.writtenHash;
  }
  return { edits, baseHashes };
}
