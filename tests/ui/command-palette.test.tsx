// Cmd+K palette: default actions, fuzzy search over entities, keyboard
// navigation and what running an item does to the app.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../src/renderer/src/App";
import { CommandPalette } from "../../src/renderer/src/components/CommandPalette";
import { useStore } from "../../src/renderer/src/store";
import { cockpit, installCockpitMock } from "./cockpit-mock";
import { makeData, mcp, project, skill } from "./fixtures";
import { loadData } from "./store-helpers";

const DATA = makeData({
  entities: [
    mcp(),
    mcp({ id: "mcp:codex:beta", agent: "codex", name: "beta", source: { kind: "codex" } }),
    skill({ id: "skill:proj:deploy", scope: { level: "project", projectPath: "/Users/test/src/demo-app" } }),
  ],
});

function open(): void {
  act(() => useStore.getState().openPalette());
}

/** Palette rows only — the entity list behind the palette also renders <li>s. */
function rows(): HTMLElement[] {
  return within(document.querySelector(".palette-list") as HTMLElement).getAllByRole("listitem");
}

describe("CommandPalette", () => {
  it("renders nothing while closed", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists navigation actions by default, focuses the input and locks body scroll", async () => {
    loadData(DATA);
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/Search MCP servers/);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(document.activeElement).toBe(input);
    expect(document.body.style.overflow).toBe("hidden");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "→Go to MCP Servers",
      "→Go to Skills",
      "→Go to Subagents",
      "→Go to Commands",
      "→Go to Plugins",
      "→Go to Settings",
      "→Go to Instructions",
      "→Go to Projects",
      "→Go to Backups",
      "→Add project folder…",
    ]);
    expect(items[0]?.className).toBe("active");
    act(() => useStore.getState().closePalette());
    expect(document.body.style.overflow).toBe("");
  });

  it("searches entities and shows their agent and scope", async () => {
    loadData(DATA);
    render(<CommandPalette />);
    open();
    await userEvent.type(screen.getByPlaceholderText(/Search MCP servers/), "dep");
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("deploy")).toBeTruthy();
    expect(within(item).getByText("Claude Code")).toBeTruthy();
    expect(within(item).getByText("demo-app")).toBeTruthy();
    expect(within(item).getByText("◆")).toBeTruthy();
  });

  it("says when nothing matches", async () => {
    loadData(DATA);
    render(<CommandPalette />);
    open();
    await userEvent.type(screen.getByPlaceholderText(/Search MCP servers/), "zzzz");
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("navigates with arrow keys, clamps at both ends and runs the active item on Enter", async () => {
    installCockpitMock(DATA);
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    open();
    const input = screen.getByPlaceholderText(/Search MCP servers/);
    await userEvent.type(input, "{ArrowUp}{ArrowDown}{ArrowDown}");
    expect(rows()[2]?.className).toBe("active");
    await userEvent.type(input, "{ArrowDown}".repeat(20));
    expect(rows()[9]?.className).toBe("active");
    await userEvent.type(input, "{ArrowUp}");
    expect(rows()[8]?.className).toBe("active");
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByPlaceholderText(/Search MCP servers/)).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Backups" })).toBeTruthy();
  });

  it("opens the entity's section and selects it when an entity is chosen", async () => {
    installCockpitMock(DATA);
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    open();
    await userEvent.type(screen.getByPlaceholderText(/Search MCP servers/), "beta");
    await userEvent.hover(rows()[0] as HTMLElement);
    expect(rows()[0]?.className).toBe("active");
    await userEvent.click(rows()[0] as HTMLElement);
    expect(useStore.getState().section).toBe("mcp");
    expect(useStore.getState().selectedId).toBe("mcp:codex:beta");
    expect(screen.getByRole("heading", { name: "Edit: beta" })).toBeTruthy();
  });

  it("selects an entity in another section", async () => {
    installCockpitMock(DATA);
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    open();
    await userEvent.type(screen.getByPlaceholderText(/Search MCP servers/), "deploy{Enter}");
    expect(screen.getByRole("heading", { level: 1, name: "Skills" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit: deploy" })).toBeTruthy();
  });

  it("runs the add-project action and swaps in the returned scan", async () => {
    loadData(DATA);
    render(<CommandPalette />);
    open();
    const next = makeData({ projects: [project()] });
    cockpit().addProject.mockResolvedValueOnce(next);
    await userEvent.click(screen.getByText("Add project folder…"));
    await act(async () => {});
    expect(screen.queryByRole("list")).toBeNull();
    expect(useStore.getState().data).toBe(next);
  });

  it("keeps the current data when the folder picker is cancelled", async () => {
    loadData(DATA);
    render(<CommandPalette />);
    open();
    await userEvent.click(screen.getByText("Add project folder…"));
    await act(async () => {});
    expect(useStore.getState().data).toBe(DATA);
  });

  it("does nothing on Enter when the list is empty", async () => {
    loadData(DATA);
    render(<CommandPalette />);
    open();
    await userEvent.type(screen.getByPlaceholderText(/Search MCP servers/), "zzzz{Enter}");
    expect(screen.getByPlaceholderText(/Search MCP servers/)).toBeTruthy();
  });

  it("closes on backdrop click but not on clicks inside the panel", async () => {
    render(<CommandPalette />);
    open();
    await userEvent.click(screen.getByRole("list"));
    expect(screen.getByRole("list")).toBeTruthy();
    await userEvent.click(document.querySelector(".palette-backdrop") as HTMLElement);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("resets the query every time it opens", async () => {
    render(<CommandPalette />);
    open();
    await userEvent.type(screen.getByPlaceholderText(/Search MCP servers/), "abc{Escape}");
    open();
    expect((screen.getByPlaceholderText(/Search MCP servers/) as HTMLInputElement).value).toBe("");
  });
});
