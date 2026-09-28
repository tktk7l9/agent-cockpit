import { describe, expect, it } from "vitest";
import { createdDirOf, planUndo, type AppliedFile } from "../src/lib/undo";

describe("planUndo", () => {
  it("writes back the previous text of a modified file, guarded by the written hash", () => {
    const applied: AppliedFile[] = [{ path: "/h/.claude.json", prevText: "old\n", writtenHash: "h-new" }];
    expect(planUndo(applied)).toEqual({
      edits: [{ path: "/h/.claude.json", newText: "old\n", createDirs: ["/h"] }],
      baseHashes: { "/h/.claude.json": "h-new" },
    });
  });

  it("deletes a file the apply created", () => {
    const applied: AppliedFile[] = [{ path: "/h/.claude/agents/a.md", prevText: null, writtenHash: "h1" }];
    expect(planUndo(applied)).toEqual({
      edits: [{ path: "/h/.claude/agents/a.md", newText: null }],
      baseHashes: { "/h/.claude/agents/a.md": "h1" },
    });
  });

  it("recreates a deleted file together with its (possibly removed) directory", () => {
    const applied: AppliedFile[] = [{ path: "/h/.claude/skills/x/SKILL.md", prevText: "body", writtenHash: null }];
    expect(planUndo(applied)).toEqual({
      edits: [{ path: "/h/.claude/skills/x/SKILL.md", newText: "body", createDirs: ["/h/.claude/skills/x"] }],
      baseHashes: { "/h/.claude/skills/x/SKILL.md": null },
    });
  });

  it("keeps a root-level path's directory as '/'", () => {
    expect(planUndo([{ path: "/f", prevText: "a", writtenHash: "h" }]).edits[0]?.createDirs).toEqual(["/"]);
  });

  it("handles several files and an empty list", () => {
    expect(planUndo([]).edits).toEqual([]);
    const two = planUndo([
      { path: "/a/1", prevText: "1", writtenHash: "x" },
      { path: "/a/2", prevText: null, writtenHash: "y" },
    ]);
    expect(two.edits.map((e) => e.path)).toEqual(["/a/1", "/a/2"]);
  });
});

describe("planUndo with a created directory", () => {
  it("removes the directory the apply created once the file is gone (new skill folder)", () => {
    const applied: AppliedFile[] = [
      { path: "/h/.claude/skills/x/SKILL.md", prevText: null, writtenHash: "h1", createdDir: "/h/.claude/skills/x" },
    ];
    expect(planUndo(applied).edits).toEqual([
      { path: "/h/.claude/skills/x/SKILL.md", newText: null, deleteDirIfEmpty: "/h/.claude/skills/x" },
    ]);
  });
});

describe("createdDirOf", () => {
  const edit = { path: "/h/.claude/skills/x/SKILL.md", newText: "b", createDirs: ["/h/.claude/skills/x"] };

  it("reports the parent directory when the apply had to create it", () => {
    expect(createdDirOf(edit, () => false)).toBe("/h/.claude/skills/x");
  });

  it("reports nothing when the directory already existed", () => {
    expect(createdDirOf(edit, () => true)).toBeUndefined();
  });

  it("reports nothing for deletes or edits that create no directories", () => {
    expect(createdDirOf({ path: "/h/a.md", newText: null }, () => false)).toBeUndefined();
    expect(createdDirOf({ path: "/h/a.md", newText: "x" }, () => false)).toBeUndefined();
  });

  it("ignores created ancestors other than the file's own directory", () => {
    expect(createdDirOf({ path: "/h/agents/a.md", newText: "x", createDirs: ["/h"] }, () => false)).toBeUndefined();
  });
});
