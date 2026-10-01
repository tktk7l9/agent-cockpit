// A fully mocked preload bridge (window.cockpit). Every method is a vi.fn with
// a harmless default so tests only override what they assert on.

import { vi, type Mock } from "vitest";
import type { CockpitApi, ScanResultPayload } from "../../src/shared/ipc";
import { makeData } from "./fixtures";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K] };

export type CockpitMock = Mocked<CockpitApi> & { emitChanged(): void };

let current: CockpitMock | null = null;

export function installCockpitMock(data: ScanResultPayload = makeData()): CockpitMock {
  const changedListeners = new Set<() => void>();
  const mock: CockpitMock = {
    scan: vi.fn(async () => data),
    preview: vi.fn(async () => ({ ok: true as const, files: [] })),
    apply: vi.fn(async () => ({ status: "ok" as const })),
    addProject: vi.fn(async () => null),
    removeProject: vi.fn(async () => data),
    listBackups: vi.fn(async () => []),
    previewRestore: vi.fn(async () => ({ ok: true as const, files: [] })),
    applyRestore: vi.fn(async () => ({ status: "ok" as const })),
    undoLastApply: vi.fn(async () => ({ status: "ok" as const })),
    reveal: vi.fn(async () => undefined),
    mcpTest: vi.fn(async () => ({ ok: true, phase: "protocol" as const, detail: "server 1.0", elapsedMs: 12 })),
    checkUpdate: vi.fn(async () => ({ status: "up-to-date" as const, current: "0.1.0" })),
    openReleases: vi.fn(async () => undefined),
    onChanged: vi.fn((callback: () => void) => {
      changedListeners.add(callback);
      return () => changedListeners.delete(callback);
    }),
    emitChanged: () => {
      for (const listener of changedListeners) listener();
    },
  };
  Object.defineProperty(window, "cockpit", { value: mock, writable: true, configurable: true });
  current = mock;
  return mock;
}

export function cockpit(): CockpitMock {
  if (!current) throw new Error("installCockpitMock() has not run");
  return current;
}
