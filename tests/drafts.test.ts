import { describe, expect, it } from "vitest";
import {
  clearDraft,
  clearDraftFields,
  draftKey,
  hasDraft,
  openDraftKey,
  readDraftField,
  withDraftField,
  type Drafts,
} from "../src/lib/drafts";

describe("drafts", () => {
  it("keys an existing entity by id and a new one by kind", () => {
    expect(draftKey("mcp", "claude:mcp:x")).toBe("claude:mcp:x");
    expect(draftKey("skill", undefined)).toBe("new:skill");
  });

  it("stores and reads fields without mutating the previous map", () => {
    const empty: Drafts = {};
    const one = withDraftField(empty, "k", "name", "a");
    const two = withDraftField(one, "k", "body", "b");
    expect(empty).toEqual({});
    expect(one).toEqual({ k: { name: "a" } });
    expect(two).toEqual({ k: { name: "a", body: "b" } });
    expect(readDraftField(two, "k", "name", "fallback")).toBe("a");
    expect(readDraftField(two, "k", "missing", "fallback")).toBe("fallback");
    expect(readDraftField(two, "other", "name", "fallback")).toBe("fallback");
  });

  it("keeps an explicitly stored empty string instead of the fallback", () => {
    expect(readDraftField(withDraftField({}, "k", "name", ""), "k", "name", "orig")).toBe("");
  });

  it("clears one draft and reports presence", () => {
    const d = withDraftField(withDraftField({}, "a", "f", 1), "b", "f", 2);
    expect(hasDraft(d, "a")).toBe(true);
    const cleared = clearDraft(d, "a");
    expect(hasDraft(cleared, "a")).toBe(false);
    expect(hasDraft(cleared, "b")).toBe(true);
    expect(clearDraft(d, "zzz")).toBe(d);
  });
});

describe("clearDraftFields", () => {
  it("clears only the saved form's fields and keeps the rest of the draft", () => {
    const d = withDraftField(withDraftField({}, "s", "perm.allow", ["Bash(ls)"]), "s", "raw", "{}");
    expect(clearDraftFields(d, "s", ["perm.allow", "perm.deny"])).toEqual({ s: { raw: "{}" } });
  });

  it("drops the draft when no field is left", () => {
    const d = withDraftField({}, "s", "raw", "{}");
    expect(hasDraft(clearDraftFields(d, "s", ["raw"]), "s")).toBe(false);
  });

  it("returns the same map when the key has no draft", () => {
    const d: Drafts = {};
    expect(clearDraftFields(d, "s", ["raw"])).toBe(d);
  });
});

describe("openDraftKey", () => {
  it("uses the selected entity id first", () => {
    expect(openDraftKey("claude:mcp:x", true, "mcp")).toBe("claude:mcp:x");
  });

  it("uses the new-entity key of the section while creating", () => {
    expect(openDraftKey(null, true, "skill")).toBe(draftKey("skill", undefined));
  });

  it("is null when no editor is open", () => {
    expect(openDraftKey(null, false, "mcp")).toBeNull();
  });
});
