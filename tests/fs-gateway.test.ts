// Main-process write pipeline against real (temp) files: backups, atomic
// writes with mode preservation, conflict detection, deletes.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyFileEdits,
  decodeBackupId,
  hashOrNull,
  listBackups,
  readBackup,
  readTextIfExists,
  resolveAndCheck,
  sha256,
  writeBackup,
} from "../src/main/fs-gateway";

let tmp: string;
let userData: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-test-"));
  userData = path.join(tmp, "userData");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("applyFileEdits", () => {
  it("writes atomically, preserving file mode", () => {
    const target = path.join(tmp, "config.toml");
    fs.writeFileSync(target, "a = 1\n", { mode: 0o600 });
    const base = { [target]: hashOrNull("a = 1\n") };
    const outcome = applyFileEdits(userData, [{ path: target, newText: "a = 2\n" }], base);
    expect(outcome.status).toBe("ok");
    expect(fs.readFileSync(target, "utf8")).toBe("a = 2\n");
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it("detects conflicts when the file changed after preview", () => {
    const target = path.join(tmp, "f.json");
    fs.writeFileSync(target, "{}");
    const base = { [target]: sha256("something-else") };
    const outcome = applyFileEdits(userData, [{ path: target, newText: "{new}" }], base);
    expect(outcome).toEqual({ status: "conflict", conflictPath: target });
    expect(fs.readFileSync(target, "utf8")).toBe("{}"); // untouched
  });

  it("detects conflicts when an expected-absent file appeared", () => {
    const target = path.join(tmp, "new.json");
    fs.writeFileSync(target, "surprise");
    const outcome = applyFileEdits(userData, [{ path: target, newText: "x" }], { [target]: null });
    expect(outcome.status).toBe("conflict");
  });

  it("backs up originals before writing and restores byte-identically", () => {
    const target = path.join(tmp, "settings.json");
    fs.writeFileSync(target, '{"model": "opus"}\n');
    applyFileEdits(userData, [{ path: target, newText: '{"model": "sonnet"}\n' }], {
      [target]: hashOrNull('{"model": "opus"}\n'),
    });
    const backups = listBackups(userData);
    expect(backups).toHaveLength(1);
    const b = backups[0];
    expect(b?.sourcePath).toBe(target);
    expect(readBackup(userData, b?.id ?? "")).toBe('{"model": "opus"}\n');
    expect(decodeBackupId(b?.id ?? "").sourcePath).toBe(target);
  });

  it("creates parent dirs for new files and deletes empty skill dirs", () => {
    const skillFile = path.join(tmp, "skills", "new-skill", "SKILL.md");
    const outcome = applyFileEdits(
      userData,
      [{ path: skillFile, newText: "---\nname: new-skill\n---\nbody\n", createDirs: [path.dirname(skillFile)] }],
      {},
    );
    expect(outcome.status).toBe("ok");
    expect(fs.existsSync(skillFile)).toBe(true);

    const del = applyFileEdits(
      userData,
      [{ path: skillFile, newText: null, deleteDirIfEmpty: path.dirname(skillFile) }],
      { [skillFile]: hashOrNull(readTextIfExists(skillFile)) },
    );
    expect(del.status).toBe("ok");
    expect(fs.existsSync(path.dirname(skillFile))).toBe(false);
  });

  it("prunes backups beyond the retention limit", () => {
    const target = path.join(tmp, "f.txt");
    for (let i = 0; i < 55; i++) writeBackup(userData, target, `content-${i}`);
    expect(listBackups(userData).length).toBe(50);
  });

  it("rejects path traversal in backup ids", () => {
    expect(() => readBackup(userData, "../../etc/passwd")).toThrow(/invalid backup id/);
    expect(() => readBackup(userData, "enc")).toThrow(/invalid backup id/);
  });
});

describe("resolveAndCheck", () => {
  it("allows in-root paths and rejects outside/denied paths", () => {
    const home = tmp;
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    expect(resolveAndCheck(home, [], path.join(home, ".claude/settings.json"))).toBe(path.join(home, ".claude/settings.json"));
    expect(() => resolveAndCheck(home, [], "/etc/passwd")).toThrow(/not allowed/);
    expect(() => resolveAndCheck(home, [], path.join(home, ".codex/auth.json"))).toThrow(/not allowed/);
  });

  it("rejects symlinks that escape the allowlist", () => {
    const home = path.join(tmp, "home");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "target.json"), "{}");
    fs.symlinkSync(path.join(outside, "target.json"), path.join(home, ".claude", "link.json"));
    expect(() => resolveAndCheck(home, [], path.join(home, ".claude", "link.json"))).toThrow(/not allowed/);
  });
});
