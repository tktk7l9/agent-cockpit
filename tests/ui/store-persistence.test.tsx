// Persisted UI state (section + agent filter) survives a restart and
// tolerates a missing, corrupt or throwing localStorage.

import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

async function freshStore(): Promise<typeof import("../../src/renderer/src/store")> {
  vi.resetModules();
  return import("../../src/renderer/src/store");
}

describe("persisted ui state", () => {
  it("restores a saved section and agent filter", async () => {
    localStorage.setItem("ui-state", JSON.stringify({ section: "backups", agentFilter: "codex" }));
    const { useStore } = await freshStore();
    expect(useStore.getState().section).toBe("backups");
    expect(useStore.getState().agentFilter).toBe("codex");
  });

  it("falls back to defaults for unknown values or corrupt JSON", async () => {
    localStorage.setItem("ui-state", JSON.stringify({ section: "nope", agentFilter: 3 }));
    let store = await freshStore();
    expect(store.useStore.getState().section).toBe("mcp");
    expect(store.useStore.getState().agentFilter).toBe("all");

    localStorage.setItem("ui-state", "{ not json");
    store = await freshStore();
    expect(store.useStore.getState().section).toBe("mcp");
  });

  it("keeps working when localStorage refuses writes", async () => {
    const { useStore } = await freshStore();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      act(() => useStore.getState().setSection("plugin"));
      act(() => useStore.getState().setAgentFilter("cursor"));
      expect(useStore.getState().section).toBe("plugin");
      expect(useStore.getState().agentFilter).toBe("cursor");
    } finally {
      setItem.mockRestore();
    }
  });

  it("does nothing when discarding a draft that does not exist", async () => {
    const { useStore } = await freshStore();
    act(() => useStore.getState().discardDraft("missing"));
    expect(useStore.getState().toast).toBeNull();
  });
});
