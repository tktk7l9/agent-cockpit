// Instructions, Plugins, Projects and Backups: single-purpose views whose
// behaviour is a table or editor plus one or two actions each.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { useStore } from "../../src/renderer/src/store";
import { BackupsView } from "../../src/renderer/src/views/BackupsView";
import { InstructionsView } from "../../src/renderer/src/views/InstructionsView";
import { PluginsView } from "../../src/renderer/src/views/PluginsView";
import { ProjectsView } from "../../src/renderer/src/views/ProjectsView";
import { cockpit } from "./cockpit-mock";
import { HOME, PROJECT, instructions, makeData, plugin, project } from "./fixtures";
import { loadData } from "./store-helpers";

const row = (name: string) => screen.getByText(name, { selector: "strong" }).closest("button") as HTMLButtonElement;

async function editor(): Promise<EditorView> {
  for (let i = 0; i < 50; i += 1) {
    const found = document.querySelector(".cm-editor");
    if (found) return EditorView.findFromDOM(found as HTMLElement) as EditorView;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error("editor did not mount");
}

describe("InstructionsView", () => {
  it("lists instruction files, marking read-only ones", () => {
    loadData(makeData({ entities: [instructions(), instructions({ id: "rules", agent: "codex", name: "default.rules", readOnly: true, filePath: `${HOME}/.codex/rules/default.rules` })] }));
    render(<InstructionsView />);
    expect(within(row("default.rules")).getByText("read-only")).toBeTruthy();
    expect(within(row("CLAUDE.md")).queryByText("read-only")).toBeNull();
  });

  it("shows the empty state", () => {
    loadData(makeData());
    render(<InstructionsView />);
    expect(screen.getByText("No instruction files found.")).toBeTruthy();
  });

  it("edits the body and saves it as markdown", async () => {
    loadData(makeData({ entities: [instructions()] }));
    render(<InstructionsView />);
    await userEvent.click(row("CLAUDE.md"));
    expect(screen.getByRole("heading", { name: "CLAUDE.md" })).toBeTruthy();
    const view = await editor();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "- Be brief\n" } }));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "writeRaw",
      filePath: `${HOME}/.claude/CLAUDE.md`,
      format: "markdown",
      newText: "# Rules\n- Be brief\n",
    });
    expect(useStore.getState().preview?.options).toEqual({ draftKey: "instructions:claude:user", subject: "CLAUDE.md" });
    await userEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(cockpit().reveal).toHaveBeenCalledWith(`${HOME}/.claude/CLAUDE.md`);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: "Save…" })).toBeNull();
  });

  it("offers no save for read-only files", async () => {
    loadData(makeData({ entities: [instructions({ readOnly: true })] }));
    render(<InstructionsView />);
    await userEvent.click(row("CLAUDE.md"));
    expect(screen.queryByRole("button", { name: "Save…" })).toBeNull();
    expect((await editor()).state.readOnly).toBe(true);
  });
});

describe("PluginsView", () => {
  it("shows the empty state", () => {
    loadData(makeData());
    render(<PluginsView />);
    expect(screen.getByText("No plugins found.")).toBeTruthy();
  });

  it("tabulates plugins and toggles them through a preview", async () => {
    loadData(
      makeData({
        entities: [
          plugin(),
          plugin({ id: "p2", agent: "codex", key: "fmt@shop", marketplace: "shop", enabled: false, version: undefined, filePath: `${HOME}/.codex/config.toml` }),
        ],
      }),
    );
    render(<PluginsView />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]?.textContent).toContain("linter");
    expect(rows[0]?.textContent).toContain("1.2.3");
    expect(rows[1]?.textContent).toContain("—");
    expect(within(rows[0] as HTMLElement).getByText("On")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("Off")).toBeTruthy();

    await userEvent.click(screen.getByRole("switch", { name: "Enable linter" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "togglePlugin",
      agent: "claude",
      filePath: `${HOME}/.claude/settings.json`,
      key: "linter@market",
      enabled: false,
    });
    expect(useStore.getState().preview?.options).toEqual({ subject: "linter" });

    await userEvent.click(screen.getByRole("switch", { name: "Enable fmt" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith(expect.objectContaining({ agent: "codex", key: "fmt@shop", enabled: true }));
    await userEvent.click(screen.getAllByRole("button", { name: "Reveal in Finder" })[1] as HTMLElement);
    expect(cockpit().reveal).toHaveBeenCalledWith(`${HOME}/.codex/config.toml`);
  });
});

describe("ProjectsView", () => {
  it("shows the empty state", () => {
    loadData(makeData());
    render(<ProjectsView />);
    expect(screen.getByText("No projects discovered yet.")).toBeTruthy();
  });

  it("lists projects and only lets manually added ones be removed", async () => {
    loadData(
      makeData({
        projects: [project(PROJECT, { sources: ["claude", "codex"], codexTrustLevel: "trusted" }), project("/Users/test/src/other", { sources: ["manual"] })],
      }),
    );
    render(<ProjectsView />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]?.textContent).toContain("claude, codex");
    expect(rows[0]?.textContent).toContain("trusted");
    expect(rows[1]?.textContent).toContain("—");
    expect(within(rows[0] as HTMLElement).queryByRole("button", { name: "Remove" })).toBeNull();

    const next = makeData({ projects: [project()] });
    cockpit().removeProject.mockResolvedValueOnce(next);
    await userEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Remove" }));
    expect(cockpit().removeProject).toHaveBeenCalledWith("/Users/test/src/other");
    expect(useStore.getState().data).toBe(next);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("adds a folder and toasts, or keeps quiet when the picker is cancelled", async () => {
    loadData(makeData());
    render(<ProjectsView />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add folder…" }));
    expect(useStore.getState().toast).toBeNull();

    const next = makeData({ projects: [project()] });
    cockpit().addProject.mockResolvedValueOnce(next);
    await userEvent.click(screen.getByRole("button", { name: "+ Add folder…" }));
    expect(useStore.getState().data).toBe(next);
    expect(useStore.getState().toast?.text).toBe("Project added");
    expect(screen.getByText(PROJECT)).toBeTruthy();
  });
});

describe("BackupsView", () => {
  it("loads backups on mount and shows the empty state", async () => {
    render(<BackupsView />);
    await act(async () => {});
    expect(cockpit().listBackups).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No backups yet — they appear after your first save.")).toBeTruthy();
  });

  it("lists backups with local time and size, refreshes, and previews a restore", async () => {
    cockpit().listBackups.mockResolvedValue([
      { id: "b1", sourcePath: `${HOME}/.claude.json`, timestamp: "2026-09-27T10-11-12-123Z", size: 512 },
      { id: "b2", sourcePath: `${HOME}/.codex/config.toml`, timestamp: "2026-09-27T10-11-12-123Z-1", size: 2048 },
    ]);
    render(<BackupsView />);
    await screen.findByText("512 B");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("512 B");
    expect(rows[1]?.textContent).toContain("2.0 KB");
    expect(rows[0]?.textContent).toMatch(/2026-09-27 \d{2}:11:12/);

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(cockpit().listBackups).toHaveBeenCalledTimes(2);

    await userEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Restore…" }));
    expect(cockpit().previewRestore).toHaveBeenCalledWith("b2");
    expect(useStore.getState().preview?.restoreId).toBe("b2");
  });
});
