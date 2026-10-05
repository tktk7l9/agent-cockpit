// App shell: navigation, agent filter, file-change handling, toasts, update
// banner and the Cmd+K shortcut — all driven through the DOM.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/src/App";
import { useStore } from "../../src/renderer/src/store";
import { cockpit, installCockpitMock } from "./cockpit-mock";
import { makeData, mcp, skill } from "./fixtures";

const nav = () => screen.getByRole("navigation");

describe("App", () => {
  it("scans on mount and shows a loading state until data arrives", async () => {
    let resolveScan: (data: ReturnType<typeof makeData>) => void = () => {};
    cockpit().scan.mockImplementation(() => new Promise((resolve) => (resolveScan = resolve)));
    render(<App />);
    expect(screen.getByText("Scanning agent configuration…")).toBeTruthy();
    await act(async () => resolveScan(makeData({ entities: [mcp()] })));
    expect(screen.queryByText("Scanning agent configuration…")).toBeNull();
    expect(screen.getByRole("heading", { name: "MCP Servers" })).toBeTruthy();
  });

  it("shows entity counts per section and filters them by agent", async () => {
    installCockpitMock(
      makeData({
        entities: [mcp(), mcp({ id: "mcp:codex:beta", agent: "codex", name: "beta", source: { kind: "codex" } }), skill()],
      }),
    );
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    const mcpNav = within(nav()).getByRole("button", { name: /MCP Servers/ });
    expect(mcpNav.textContent).toContain("2");
    expect(within(nav()).getByRole("button", { name: /Skills/ }).textContent).toContain("1");

    await userEvent.click(screen.getByRole("button", { name: "Codex", pressed: false }));
    expect(mcpNav.textContent).toContain("1");
    expect(within(nav()).getByRole("button", { name: /Skills/ }).textContent).toContain("0");
    expect(screen.getByRole("button", { name: "Codex" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches sections from the sidebar and persists the choice", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    await userEvent.click(within(nav()).getByRole("button", { name: /Backups/ }));
    expect(screen.getByRole("heading", { name: "Backups" })).toBeTruthy();
    expect(within(nav()).getByRole("button", { name: /Backups/ }).getAttribute("aria-current")).toBe("page");
    expect(JSON.parse(localStorage.getItem("ui-state") ?? "{}")).toEqual({ section: "backups", agentFilter: "all" });

    for (const name of ["Skills", "Subagents", "Commands", "Plugins", "Settings", "Instructions", "Projects"]) {
      await userEvent.click(within(nav()).getByRole("button", { name: new RegExp(name) }));
      expect(screen.getByRole("heading", { level: 1, name })).toBeTruthy();
    }
  });

  it("refreshes silently on disk change when nothing is being edited", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    expect(cockpit().scan).toHaveBeenCalledTimes(1);
    await act(async () => cockpit().emitChanged());
    expect(cockpit().scan).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Config files changed on disk/)).toBeNull();
  });

  it("shows the stale banner instead when the open editor has a draft, and Reload discards it undoably", async () => {
    installCockpitMock(makeData({ entities: [mcp()] }));
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    await userEvent.click(screen.getByRole("button", { name: /alpha/ }));
    await userEvent.type(screen.getByLabelText("Name"), "-x");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    await act(async () => cockpit().emitChanged());
    expect(cockpit().scan).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Config files changed on disk/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Reload (discard draft)" }));
    expect(cockpit().scan).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Config files changed on disk/)).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("alpha");
    expect(screen.getByRole("status").textContent).toContain("Reloaded from disk — draft discarded");

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("alpha-x");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not auto-refresh while a diff preview is open", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    act(() => {
      useStore.setState({ preview: { mutation: null, action: "restore", options: {}, files: [], applying: false } });
    });
    await act(async () => cockpit().emitChanged());
    expect(cockpit().scan).toHaveBeenCalledTimes(1);
    expect(useStore.getState().stale).toBe(true);
  });

  it("opens the command palette with Cmd+K and closes it with Escape", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    expect(screen.queryByPlaceholderText(/Search MCP servers/)).toBeNull();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByPlaceholderText(/Search MCP servers/);
    await userEvent.type(input, "{Escape}");
    expect(screen.queryByPlaceholderText(/Search MCP servers/)).toBeNull();
  });

  it("lists parse errors in the sidebar and opens the errors modal", async () => {
    installCockpitMock(makeData({ errors: [{ path: "/Users/test/.claude.json", message: "Unexpected token" }] }));
    render(<App />);
    const button = await screen.findByRole("button", { name: /1 file\(s\) could not be parsed/ });
    await userEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Scan errors" })).toBeTruthy();
    expect(screen.getByText("Unexpected token")).toBeTruthy();
  });

  it("checks for updates on demand and offers the releases page", async () => {
    cockpit().checkUpdate.mockResolvedValueOnce({ status: "up-to-date", current: "0.1.0" });
    render(<App />);
    const check = await screen.findByRole("button", { name: "v0.1.0 — Check for updates" });
    await userEvent.click(check);
    expect(screen.getByRole("status").textContent).toContain("You're up to date (v0.1.0)");

    cockpit().checkUpdate.mockResolvedValueOnce({ status: "update-available", current: "0.1.0", latest: "0.2.0", url: "x" });
    await userEvent.click(check);
    expect(screen.getByText("New version v0.2.0 available")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open Releases" }));
    expect(cockpit().openReleases).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("New version v0.2.0 available")).toBeNull();

    cockpit().checkUpdate.mockResolvedValueOnce({ status: "error", message: "offline" });
    await userEvent.click(check);
    expect(screen.getByRole("alert").textContent).toContain("Update check failed: offline");
  });

  it("keeps error toasts until dismissed and fades success toasts on their own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<App />);
      await screen.findByRole("heading", { name: "MCP Servers" });
      act(() => useStore.getState().showToast("err", "Boom"));
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Boom");
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.getByRole("alert")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("alert")).toBeNull();

      act(() => useStore.getState().showToast("ok", "Saved"));
      expect(screen.getByRole("status").textContent).toContain("Saved");
      act(() => vi.advanceTimersByTime(4000));
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fade a newer toast when an older success toast times out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<App />);
      await screen.findByRole("heading", { name: "MCP Servers" });
      act(() => useStore.getState().showToast("ok", "First"));
      act(() => vi.advanceTimersByTime(2000));
      act(() => useStore.getState().showToast("ok", "Second"));
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByRole("status").textContent).toContain("Second");
    } finally {
      vi.useRealTimers();
    }
  });
});
