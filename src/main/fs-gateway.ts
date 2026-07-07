// All filesystem access for the app: snapshot reads, backups, atomic writes.
// Decision logic (what to write, path allow/deny) lives in src/lib; this file
// only executes it.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { FileEdit } from "../lib/model/types";
import { isPathAllowed } from "../lib/paths";

export function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashOrNull(text: string | null): string | null {
  return text === null ? null : sha256(text);
}

function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Resolve symlinks on the deepest existing ancestor, then re-check the allowlist. */
export function resolveAndCheck(home: string, projectRoots: string[], filePath: string): string {
  if (!isPathAllowed(home, projectRoots, filePath)) {
    throw new Error(`path not allowed: ${filePath}`);
  }
  let probe = filePath;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const real = fs.realpathSync(probe) + filePath.slice(probe.length);
  // compare against realpath'd roots too (macOS: /var → /private/var)
  const realHome = safeRealpath(home);
  const realRoots = projectRoots.map(safeRealpath);
  if (!isPathAllowed(home, projectRoots, real) && !isPathAllowed(realHome, realRoots, real)) {
    throw new Error(`path not allowed: ${filePath}`);
  }
  return filePath;
}

// ---- backups ----

const BACKUP_KEEP = 50;

export interface BackupRecord {
  id: string;
  sourcePath: string;
  timestamp: string;
  size: number;
}

function encodeSource(filePath: string): string {
  return encodeURIComponent(filePath);
}

export function decodeBackupId(id: string): { sourcePath: string; timestamp: string } {
  const [encoded = "", stamp = ""] = id.split("/");
  return { sourcePath: decodeURIComponent(encoded), timestamp: stamp };
}

export function backupDirFor(userDataDir: string): string {
  return path.join(userDataDir, "backups");
}

export function writeBackup(userDataDir: string, sourcePath: string, text: string): void {
  const dir = path.join(backupDirFor(userDataDir), encodeSource(sourcePath));
  fs.mkdirSync(dir, { recursive: true });
  const base = new Date().toISOString().replace(/[:.]/g, "-");
  let stamp = base;
  for (let n = 1; fs.existsSync(path.join(dir, stamp)); n += 1) stamp = `${base}-${n}`;
  fs.writeFileSync(path.join(dir, stamp), text, "utf8");
  const entries = fs.readdirSync(dir).sort();
  while (entries.length > BACKUP_KEEP) {
    const oldest = entries.shift() as string;
    fs.rmSync(path.join(dir, oldest));
  }
}

export function listBackups(userDataDir: string): BackupRecord[] {
  const root = backupDirFor(userDataDir);
  if (!fs.existsSync(root)) return [];
  const out: BackupRecord[] = [];
  for (const encoded of fs.readdirSync(root)) {
    const dir = path.join(root, encoded);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const stamp of fs.readdirSync(dir)) {
      const stat = fs.statSync(path.join(dir, stamp));
      out.push({
        id: `${encoded}/${stamp}`,
        sourcePath: decodeURIComponent(encoded),
        timestamp: stamp,
        size: stat.size,
      });
    }
  }
  return out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

export function readBackup(userDataDir: string, id: string): string {
  const [encoded = "", stamp = ""] = id.split("/");
  if (encoded.includes("..") || stamp.includes("..") || stamp === "") {
    throw new Error("invalid backup id");
  }
  return fs.readFileSync(path.join(backupDirFor(userDataDir), encoded, stamp), "utf8");
}

// ---- atomic writes ----

function atomicWrite(filePath: string, text: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  let mode = 0o644;
  try {
    mode = fs.statSync(filePath).mode & 0o777;
  } catch {
    // new file — default mode
  }
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filePath);
}

export interface ApplyOutcome {
  status: "ok" | "conflict";
  conflictPath?: string;
}

/**
 * Verify base hashes, back up originals, then apply the edits atomically.
 * `baseHashes` maps path -> sha256 at preview time (null = expected absent).
 */
export function applyFileEdits(
  userDataDir: string,
  edits: FileEdit[],
  baseHashes: Record<string, string | null>,
): ApplyOutcome {
  for (const edit of edits) {
    const current = hashOrNull(readTextIfExists(edit.path));
    const expected = Object.prototype.hasOwnProperty.call(baseHashes, edit.path) ? baseHashes[edit.path] ?? null : current;
    if (current !== expected) {
      return { status: "conflict", conflictPath: edit.path };
    }
  }
  for (const edit of edits) {
    const current = readTextIfExists(edit.path);
    if (current !== null) writeBackup(userDataDir, edit.path, current);
    if (edit.newText === null) {
      if (current !== null) fs.rmSync(edit.path);
      if (edit.deleteDirIfEmpty && fs.existsSync(edit.deleteDirIfEmpty) && fs.readdirSync(edit.deleteDirIfEmpty).length === 0) {
        fs.rmdirSync(edit.deleteDirIfEmpty);
      }
    } else {
      for (const dir of edit.createDirs ?? []) fs.mkdirSync(dir, { recursive: true });
      atomicWrite(edit.path, edit.newText);
    }
  }
  return { status: "ok" };
}
