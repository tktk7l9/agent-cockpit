import { describe, expect, it } from "vitest";
import { buildFrontmatterFile, parseFrontmatter, updateFrontmatter } from "../src/lib/markdown/frontmatter";

const SKILL = `---
name: keihi
# keep this comment
description: 経費整理
version: 1.1.0
---

# Body

content here
`;

describe("parseFrontmatter", () => {
  it("parses frontmatter and body", () => {
    const doc = parseFrontmatter(SKILL);
    expect(doc.hasFrontmatter).toBe(true);
    expect(doc.data["name"]).toBe("keihi");
    expect(doc.data["version"]).toBe("1.1.0");
    expect(doc.body).toBe("\n# Body\n\ncontent here\n");
  });

  it("handles files without frontmatter", () => {
    const doc = parseFrontmatter("# just markdown\n");
    expect(doc.hasFrontmatter).toBe(false);
    expect(doc.data).toEqual({});
    expect(doc.body).toBe("# just markdown\n");
  });

  it("handles unterminated fences", () => {
    const doc = parseFrontmatter("---\nname: x\nno close");
    expect(doc.hasFrontmatter).toBe(false);
    expect(doc.body).toBe("---\nname: x\nno close");
  });

  it("handles a closing fence at EOF without newline", () => {
    const doc = parseFrontmatter("---\nname: x\n---");
    expect(doc.hasFrontmatter).toBe(true);
    expect(doc.data["name"]).toBe("x");
    expect(doc.body).toBe("");
  });

  it("treats non-object yaml as empty data", () => {
    const doc = parseFrontmatter("---\n- a\n- b\n---\nbody\n");
    expect(doc.data).toEqual({});
    expect(doc.body).toBe("body\n");
  });
});

describe("updateFrontmatter", () => {
  it("updates keys while preserving comments and body", () => {
    const out = updateFrontmatter(SKILL, { description: "new desc" });
    expect(out).toContain("# keep this comment");
    expect(out).toContain("description: new desc");
    expect(out).toContain("# Body\n\ncontent here\n");
    expect(out).toContain("name: keihi");
  });

  it("deletes keys with undefined", () => {
    const out = updateFrontmatter(SKILL, { version: undefined });
    expect(out).not.toContain("version");
    expect(out).toContain("name: keihi");
  });

  it("prepends frontmatter to plain files", () => {
    const out = updateFrontmatter("# body only\n", { description: "d" });
    expect(out).toBe("---\ndescription: d\n---\n# body only\n");
  });

  it("does not prepend empty frontmatter to plain files", () => {
    const out = updateFrontmatter("# body only\n", { description: undefined });
    expect(out).toBe("# body only\n");
  });

  it("populates an empty frontmatter document", () => {
    const out = updateFrontmatter("---\n---\nbody\n", { name: "x" });
    expect(out).toContain("name: x");
    expect(out).toContain("body\n");
  });
});

describe("buildFrontmatterFile", () => {
  it("builds a fresh file", () => {
    const out = buildFrontmatterFile({ name: "new-skill", description: "d" }, "# Hello\n");
    expect(out).toBe("---\nname: new-skill\ndescription: d\n---\n\n# Hello\n");
  });

  it("normalizes a missing trailing newline", () => {
    const out = buildFrontmatterFile({ name: "x" }, "body");
    expect(out.endsWith("body\n")).toBe(true);
  });

  it("accepts an empty body", () => {
    const out = buildFrontmatterFile({ name: "x" }, "");
    expect(out).toBe("---\nname: x\n---\n\n");
  });
});
