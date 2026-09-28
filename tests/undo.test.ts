import { describe, expect, it } from "vitest";
import { planUndo, type AppliedFile } from "../src/lib/undo";

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
