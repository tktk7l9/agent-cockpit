// Scan errors modal: lists unparsable files, reveals them, jumps to the raw
// settings editor when one exists, and traps focus like the diff modal.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../src/renderer/src/App";
import { ScanErrorsModal } from "../../src/renderer/src/components/ScanErrorsModal";
import { useStore } from "../../src/renderer/src/store";
import { cockpit, installCockpitMock } from "./cockpit-mock";
import { makeData, settings } from "./fixtures";
import { loadData } from "./store-helpers";

// A broken codex config.toml still yields a raw-only settings entity (the
// inventory drops broken claude settings.json files entirely).
const BROKEN = "/Users/test/.codex/config.toml";
const DATA = makeData({
  errors: [
    { path: "/Users/test/.claude/settings.json", message: "Unexpected token }" },
    { path: BROKEN, message: "bad toml" },
  ],
  entities: [
    settings({ id: "settings:codex:user", agent: "codex", name: "config.toml", format: "toml", filePath: BROKEN, rawText: "[broken", known: {} }),
  ],
});

describe("ScanErrorsModal", () => {
  it("renders nothing while closed or without data", () => {
    render(<ScanErrorsModal />);
    act(() => useStore.getState().openErrors());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists each error with Reveal and, when parsed as settings, an Open raw button", async () => {
    loadData(DATA);
    render(<ScanErrorsModal />);
    act(() => useStore.getState().openErrors());
    const dialog = screen.getByRole("dialog", { name: "Scan errors" });
    expect(dialog.textContent).toContain("2 file(s)");
    expect(screen.getByText("Unexpected token }")).toBeTruthy();
    expect(screen.getByText("bad toml")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open raw" })).toHaveLength(1);
    await userEvent.click(screen.getAllByRole("button", { name: "Reveal in Finder" })[0] as HTMLElement);
    expect(cockpit().reveal).toHaveBeenCalledWith("/Users/test/.claude/settings.json");
  });

  it("jumps to the raw settings editor from Open raw", async () => {
    installCockpitMock(DATA);
    render(<App />);
    await screen.findByRole("button", { name: /2 file\(s\) could not be parsed/ });
    await userEvent.click(screen.getByRole("button", { name: /could not be parsed/ }));
    await userEvent.click(screen.getByRole("button", { name: "Open raw" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(useStore.getState().selectedId).toBe("settings:codex:user");
    expect(screen.getByRole("heading", { name: "config.toml" })).toBeTruthy();
  });

  it("rescans from the footer and closes via Close, Escape and the backdrop", async () => {
    loadData(DATA);
    render(<ScanErrorsModal />);
    act(() => useStore.getState().openErrors());
    await userEvent.click(screen.getByRole("button", { name: "Rescan" }));
    expect(cockpit().scan).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => useStore.getState().openErrors());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => useStore.getState().openErrors());
    await userEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses the first button on open and wraps Tab in both directions", async () => {
    loadData(DATA);
    render(<ScanErrorsModal />);
    act(() => useStore.getState().openErrors());
    const first = screen.getAllByRole("button")[0] as HTMLElement;
    const last = screen.getByRole("button", { name: "Rescan" });
    expect(document.activeElement).toBe(first);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
    await userEvent.tab();
    expect(document.activeElement).not.toBe(first);
  });
});
