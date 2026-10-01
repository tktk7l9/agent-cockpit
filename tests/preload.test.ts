// The preload bridge: every window.cockpit method maps to exactly one IPC
// channel, and nothing else is exposed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS, type CockpitApi } from "../src/shared/ipc";

const electron = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  invoke: vi.fn(async (..._args: unknown[]) => "result"),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => (electron.exposed[key] = api) },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
}));

let api: CockpitApi;

beforeEach(async () => {
  vi.clearAllMocks();
  await import("../src/preload/index");
  api = electron.exposed["cockpit"] as CockpitApi;
});

describe("preload bridge", () => {
  it("exposes only the cockpit api", () => {
    expect(Object.keys(electron.exposed)).toEqual(["cockpit"]);
    expect(Object.keys(api).sort()).toEqual(Object.keys(CHANNELS).filter((k) => k !== "changed").concat("onChanged").sort());
  });

  it("forwards each call to its channel with the given arguments", async () => {
    const mutation = { op: "deleteFile" as const, filePath: "/h/.claude/commands/x.md" };
    const cases: [() => Promise<unknown>, string, unknown[]][] = [
      [() => api.scan(), CHANNELS.scan, []],
      [() => api.preview(mutation), CHANNELS.preview, [mutation]],
      [() => api.apply(mutation, { "/a": "h" }), CHANNELS.apply, [mutation, { "/a": "h" }]],
      [() => api.addProject(), CHANNELS.addProject, []],
      [() => api.removeProject("/p"), CHANNELS.removeProject, ["/p"]],
      [() => api.listBackups(), CHANNELS.listBackups, []],
      [() => api.previewRestore("id"), CHANNELS.previewRestore, ["id"]],
      [() => api.applyRestore("id", null), CHANNELS.applyRestore, ["id", null]],
      [() => api.undoLastApply(3), CHANNELS.undoLastApply, [3]],
      [() => api.reveal("/f"), CHANNELS.reveal, ["/f"]],
      [() => api.mcpTest({ name: "n", transport: "stdio" }, 5), CHANNELS.mcpTest, [{ name: "n", transport: "stdio" }, 5]],
      [() => api.checkUpdate(), CHANNELS.checkUpdate, []],
      [() => api.openReleases(), CHANNELS.openReleases, []],
    ];
    for (const [call, channel, args] of cases) {
      electron.invoke.mockClear();
      expect(await call()).toBe("result");
      expect(electron.invoke).toHaveBeenCalledWith(channel, ...args);
    }
  });

  it("subscribes to change events and unsubscribes the same listener", () => {
    const callback = vi.fn();
    const unsubscribe = api.onChanged(callback);
    expect(electron.on).toHaveBeenCalledWith(CHANNELS.changed, expect.any(Function));
    const listener = electron.on.mock.calls[0]?.[1] as () => void;
    listener();
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(electron.removeListener).toHaveBeenCalledWith(CHANNELS.changed, listener);
  });
});
