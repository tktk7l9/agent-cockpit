// Diff preview modal: what the confirm button says and does, conflict
// handling, focus trapping, and the undo flow after a successful apply.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Mutation } from "../../src/lib/mutations";
import { App } from "../../src/renderer/src/App";
import { DiffModal } from "../../src/renderer/src/components/DiffModal";
import { useStore } from "../../src/renderer/src/store";
import type { PreviewFile } from "../../src/shared/ipc";
import { cockpit } from "./cockpit-mock";
import { loadData, resetStore } from "./store-helpers";
import { makeData, mcp } from "./fixtures";

const DELETE: Mutation = { op: "deleteFile", filePath: "/Users/test/.claude/commands/ship.md" };
const WRITE: Mutation = { op: "writeRaw", filePath: "/Users/test/.claude/CLAUDE.md", format: "markdown", newText: "# New\n" };

function changedFile(path: string, extra: Partial<PreviewFile> = {}): PreviewFile {
  return {
    path,
    baseHash: "h1",
    creates: false,
    deletes: false,
    diff: [
      { type: "ctx", text: "# Rules" },
      { type: "del", text: "old" },
      { type: "add", text: "new" },
      { type: "skip", text: "…" },
    ],
    ...extra,
  };
}

async function openPreview(mutation: Mutation, files: PreviewFile[], subject?: string): Promise<void> {
  cockpit().preview.mockResolvedValueOnce({ ok: true, files });
  await act(() => useStore.getState().requestPreview(mutation, { subject }));
}

describe("DiffModal", () => {
  it("renders nothing without a preview", () => {
    render(<DiffModal />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the diff with new-file/deleted pills and a Save button named after the action", async () => {
    render(<DiffModal />);
    await openPreview(
      WRITE,
      [changedFile("/a/created.md", { creates: true }), changedFile("/a/removed.md", { deletes: true, diff: [] })],
      "CLAUDE.md",
    );
    const dialog = screen.getByRole("dialog", { name: "Review changes to CLAUDE.md" });
    expect(within(dialog).getByText("2 files")).toBeTruthy();
    expect(within(dialog).getByText("new file")).toBeTruthy();
    expect(within(dialog).getByText("deleted")).toBeTruthy();
    expect(within(dialog).getByText("(no textual change)")).toBeTruthy();
    expect(within(dialog).getByText("+ new")).toBeTruthy();
    expect(within(dialog).getByText("- old")).toBeTruthy();
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(save.className).toContain("btn-primary");
  });

  it("names delete previews and styles the confirm button as dangerous", async () => {
    render(<DiffModal />);
    await openPreview(DELETE, [changedFile("/a/ship.md", { deletes: true, diff: [] })], "ship");
    expect(screen.getByRole("dialog", { name: "Delete ship" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("btn-danger");
  });

  it("falls back to generic titles when no subject is given", async () => {
    render(<DiffModal />);
    await openPreview(DELETE, [changedFile("/a/x", { deletes: true })]);
    expect(screen.getByRole("dialog", { name: "Delete file" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await openPreview(WRITE, [changedFile("/a/x")]);
    expect(screen.getByRole("dialog", { name: "Review changes" })).toBeTruthy();
    expect(screen.getByText("1 file")).toBeTruthy();
  });

  it("disables Save when the preview has no textual change", async () => {
    render(<DiffModal />);
    await openPreview(WRITE, [changedFile("/a/x", { diff: [{ type: "ctx", text: "same" }] })]);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the preview error as a toast instead of opening", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    cockpit().preview.mockResolvedValueOnce({ ok: false, error: "path outside allowed roots" });
    await act(() => useStore.getState().requestPreview(WRITE));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("path outside allowed roots");
  });

  it("closes on Cancel, Escape and backdrop click but not on clicks inside", async () => {
    render(<DiffModal />);
    await openPreview(WRITE, [changedFile("/a/x")]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await openPreview(WRITE, [changedFile("/a/x")]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await openPreview(WRITE, [changedFile("/a/x")]);
    await userEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus into the modal and traps Tab within it", async () => {
    render(
      <>
        <button>Outside</button>
        <DiffModal />
      </>,
    );
    await openPreview(WRITE, [changedFile("/a/x")]);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab();
    expect(document.activeElement).toBe(save);
    await userEvent.tab();
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(save);
  });

  it("skips disabled buttons when wrapping focus", async () => {
    render(<DiffModal />);
    await openPreview(WRITE, [changedFile("/a/x", { diff: [] })]);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab();
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
  });

  it("applies with the previewed base hashes, toasts the result and offers Undo", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    await openPreview(WRITE, [changedFile("/a/x", { baseHash: "abc" })], "CLAUDE.md");
    cockpit().apply.mockResolvedValueOnce({ status: "ok", undoToken: 7 });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(cockpit().apply).toHaveBeenCalledWith(WRITE, { "/a/x": "abc" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Saved CLAUDE.md");
    expect(cockpit().scan).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(cockpit().undoLastApply).toHaveBeenCalledWith(7);
    expect(screen.getByRole("status").textContent).toContain("Undone — saved change reverted");
    expect(cockpit().scan).toHaveBeenCalledTimes(3);
  });

  it("offers no Undo when the apply result carries no token", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    await openPreview(WRITE, [changedFile("/a/x")]);
    cockpit().apply.mockResolvedValueOnce({ status: "ok" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status").textContent).toBe("Saved");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("explains undo conflicts and errors", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    await openPreview(WRITE, [changedFile("/a/x")]);
    cockpit().apply.mockResolvedValueOnce({ status: "ok", undoToken: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    cockpit().undoLastApply.mockResolvedValueOnce({ status: "conflict", path: "/a/x" });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("alert").textContent).toContain("Can't undo: /a/x changed after the save");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await openPreview(WRITE, [changedFile("/a/x")]);
    cockpit().apply.mockResolvedValueOnce({ status: "ok", undoToken: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    cockpit().undoLastApply.mockResolvedValueOnce({ status: "error", message: "Only the most recent save can be undone." });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("alert").textContent).toContain("Only the most recent save can be undone.");
  });

  it("shows a conflict banner and re-previews against the current file", async () => {
    render(<DiffModal />);
    await openPreview(WRITE, [changedFile("/a/x")]);
    cockpit().apply.mockResolvedValueOnce({ status: "conflict", path: "/a/x" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("File changed on disk since preview: /a/x");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);

    cockpit().preview.mockResolvedValueOnce({ ok: true, files: [changedFile("/a/x", { baseHash: "h2" })] });
    await userEvent.click(screen.getByRole("button", { name: "Re-preview" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    cockpit().apply.mockResolvedValueOnce({ status: "ok" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(cockpit().apply).toHaveBeenLastCalledWith(WRITE, { "/a/x": "h2" });
  });

  it("closes the modal when re-preview itself fails", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    await openPreview(WRITE, [changedFile("/a/x")]);
    cockpit().apply.mockResolvedValueOnce({ status: "conflict", path: "/a/x" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    cockpit().preview.mockResolvedValueOnce({ ok: false, error: "gone" });
    await userEvent.click(screen.getByRole("button", { name: "Re-preview" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("gone");
  });

  it("keeps the modal open and toasts on an apply error", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    await openPreview(WRITE, [changedFile("/a/x")]);
    cockpit().apply.mockResolvedValueOnce({ status: "error", message: "EACCES" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("EACCES");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a progress label while applying", async () => {
    render(<DiffModal />);
    await openPreview(DELETE, [changedFile("/a/x", { deletes: true })]);
    let finish: (r: { status: "ok" }) => void = () => {};
    cockpit().apply.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const busy = screen.getByRole("button", { name: "Deleting…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ status: "ok" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("previews and applies a backup restore, then reloads the backup list", async () => {
    loadData(makeData({ entities: [mcp()] }));
    render(<App />);
    cockpit().previewRestore.mockResolvedValueOnce({ ok: true, files: [changedFile("/a/x", { baseHash: "cur" })] });
    await act(() => useStore.getState().requestRestorePreview("backup-1"));
    expect(screen.getByRole("dialog", { name: "Restore backup" })).toBeTruthy();
    cockpit().listBackups.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(cockpit().applyRestore).toHaveBeenCalledWith("backup-1", "cur");
    expect(screen.getByRole("status").textContent).toBe("Restored");
    expect(cockpit().listBackups).toHaveBeenCalledTimes(1);
  });

  it("re-previews a restore after a conflict", async () => {
    render(<DiffModal />);
    cockpit().previewRestore.mockResolvedValue({ ok: true, files: [changedFile("/a/x")] });
    await act(() => useStore.getState().requestRestorePreview("backup-1"));
    cockpit().applyRestore.mockResolvedValueOnce({ status: "conflict", path: "/a/x" });
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await userEvent.click(screen.getByRole("button", { name: "Re-preview" }));
    expect(cockpit().previewRestore).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/File changed on disk/)).toBeNull();
  });

  it("toasts a failed restore preview", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "MCP Servers" });
    cockpit().previewRestore.mockResolvedValueOnce({ ok: false, error: "backup missing" });
    await act(() => useStore.getState().requestRestorePreview("nope"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("backup missing");
  });

  it("ignores repreview and confirmApply when no preview is open", async () => {
    resetStore();
    await useStore.getState().repreview();
    await useStore.getState().confirmApply();
    expect(cockpit().apply).not.toHaveBeenCalled();
    expect(cockpit().preview).not.toHaveBeenCalled();
  });
});
