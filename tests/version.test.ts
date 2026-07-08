import { describe, expect, it } from "vitest";
import { compareVersions, parseVersion } from "../src/lib/version";

describe("parseVersion", () => {
  it("parses a bare major.minor.patch", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("parses a v-prefixed tag", () => {
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("ignores a prerelease suffix", () => {
    expect(parseVersion("v1.2.3-beta.1")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("returns null for an unparseable string", () => {
    expect(parseVersion("not-a-version")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("returns 1 when a's major is greater", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("returns -1 when a's major is smaller", () => {
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
  });

  it("returns 1 when a's minor is greater (same major)", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
  });

  it("returns -1 when a's minor is smaller (same major)", () => {
    expect(compareVersions("1.1.9", "1.2.0")).toBe(-1);
  });

  it("returns 1 when a's patch is greater (same major.minor)", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
  });

  it("returns -1 when a's patch is smaller (same major.minor)", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
  });

  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "v1.2.3")).toBe(0);
  });

  it("returns null when a is unparseable", () => {
    expect(compareVersions("nonsense", "1.2.3")).toBeNull();
  });

  it("returns null when b is unparseable", () => {
    expect(compareVersions("1.2.3", "nonsense")).toBeNull();
  });
});
