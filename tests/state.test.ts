// Persisted app config (project folders + window bounds) against a temp dir.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAppConfig, saveAppConfig } from "../src/main/state";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-state-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("loadAppConfig", () => {
  it("returns an empty project list when nothing is saved yet", () => {
    expect(loadAppConfig(path.join(tmp, "missing"))).toEqual({ projects: [] });
  });

  it("round-trips projects and window bounds, creating the directory", () => {
    const dir = path.join(tmp, "userData", "nested");
    saveAppConfig(dir, { projects: ["/p/one"], windowBounds: { x: 1, y: 2, width: 300, height: 200 } });
    expect(loadAppConfig(dir)).toEqual({ projects: ["/p/one"], windowBounds: { x: 1, y: 2, width: 300, height: 200 } });
  });

  it("tolerates corrupt or oddly-typed content", () => {
    fs.writeFileSync(path.join(tmp, "app-config.json"), "{ nope");
    expect(loadAppConfig(tmp)).toEqual({ projects: [] });
    fs.writeFileSync(path.join(tmp, "app-config.json"), JSON.stringify({ projects: [1, "x"], windowBounds: { x: "1", y: 2, width: 3, height: 4 } }));
    expect(loadAppConfig(tmp)).toEqual({ projects: ["1", "x"], windowBounds: undefined });
    fs.writeFileSync(path.join(tmp, "app-config.json"), JSON.stringify({ projects: "no", windowBounds: null }));
    expect(loadAppConfig(tmp)).toEqual({ projects: [], windowBounds: undefined });
    fs.writeFileSync(path.join(tmp, "app-config.json"), JSON.stringify({ windowBounds: { x: 0, y: 0, width: Infinity, height: 1 } }));
    expect(loadAppConfig(tmp).windowBounds).toBeUndefined();
  });
});
