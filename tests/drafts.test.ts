import { describe, expect, it } from "vitest";
import { clearDraft, draftKey, hasDraft, readDraftField, withDraftField, type Drafts } from "../src/lib/drafts";

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
