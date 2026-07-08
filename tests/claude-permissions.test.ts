import { describe, expect, it } from "vitest";
import { claudePermissions } from "../src/lib/agents/claude";

describe("claudePermissions", () => {
  it("reads a full permissions block", () => {
    const p = claudePermissions(
      JSON.stringify({ permissions: { defaultMode: "plan", allow: ["Bash(ls:*)"], deny: ["Read(~/.ssh/**)"] } }),
    );
    expect(p).toEqual({ defaultMode: "plan", allow: ["Bash(ls:*)"], deny: ["Read(~/.ssh/**)"], present: true });
  });

  it("returns present:false when permissions is entirely absent", () => {
    expect(claudePermissions("{}")).toEqual({ defaultMode: undefined, allow: [], deny: [], present: false });
    expect(claudePermissions(null)).toEqual({ defaultMode: undefined, allow: [], deny: [], present: false });
  });

  it("tolerates a non-object top level", () => {
    expect(claudePermissions("[1]")).toEqual({ defaultMode: undefined, allow: [], deny: [], present: false });
  });

  it("defaults missing sub-fields when permissions is present but partial", () => {
    expect(claudePermissions(JSON.stringify({ permissions: { allow: ["Bash(npm run build)"] } }))).toEqual({
      defaultMode: undefined,
      allow: ["Bash(npm run build)"],
      deny: [],
      present: true,
    });
  });

  it("ignores malformed field types", () => {
    expect(claudePermissions(JSON.stringify({ permissions: { defaultMode: 5, allow: "not-an-array", deny: null } }))).toEqual({
      defaultMode: undefined,
      allow: [],
      deny: [],
      present: true,
    });
  });
});
