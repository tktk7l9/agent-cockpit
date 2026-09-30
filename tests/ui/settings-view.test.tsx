// Settings view: permissions form (Claude only), quick-edit rows and the raw
// editor, each saving independently and clearing only its own draft fields.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { useStore } from "../../src/renderer/src/store";
import { SettingsView } from "../../src/renderer/src/views/SettingsView";
import { cockpit } from "./cockpit-mock";
import { HOME, makeData, settings } from "./fixtures";
import { loadData } from "./store-helpers";

const row = (name: string) => screen.getByText(name, { selector: "strong" }).closest("button") as HTMLButtonElement;

const CODEX = settings({
  id: "settings:codex:user",
  agent: "codex",
  name: "config.toml",
  format: "toml",
  filePath: `${HOME}/.codex/config.toml`,
  rawText: 'model = "fast"\n',
  known: { model: "fast", approval_policy: "never" },
});

async function rawEditor(): Promise<EditorView> {
  for (let i = 0; i < 50; i += 1) {
    const found = document.querySelector(".cm-editor");
    if (found) return EditorView.findFromDOM(found as HTMLElement) as EditorView;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error("editor did not mount");
}

describe("SettingsView", () => {
  it("shows the empty state and lists files with their paths", () => {
    loadData(makeData());
    const { unmount } = render(<SettingsView />);
    expect(screen.getByText("No settings files found.")).toBeTruthy();
    unmount();
    loadData(makeData({ entities: [settings(), CODEX] }));
    render(<SettingsView />);
    expect(within(row("settings.json")).getByText(`${HOME}/.claude/settings.json`)).toBeTruthy();
    expect(within(row("config.toml")).getByText("Codex")).toBeTruthy();
  });

  it("edits Claude permissions and saves them with blank rules dropped", async () => {
    loadData(makeData({ entities: [settings()] }));
    render(<SettingsView />);
    await userEvent.click(row("settings.json"));
    const mode = screen.getByLabelText("Permissions") as HTMLSelectElement;
    expect(mode.value).toBe("plan");
    expect((screen.getByLabelText("Allow rules 1") as HTMLInputElement).value).toBe("Bash(ls)");

    await userEvent.selectOptions(mode, "acceptEdits");
    await userEvent.click(screen.getAllByRole("button", { name: "+ add" })[0] as HTMLElement);
    await userEvent.type(screen.getByLabelText("Allow rules 2"), "Read");
    await userEvent.click(screen.getAllByRole("button", { name: "+ add" })[1] as HTMLElement);
    await userEvent.type(screen.getByLabelText("Deny rules 1"), "Bash(rm -rf *)");
    await userEvent.click(screen.getAllByRole("button", { name: "+ add" })[1] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Remove Bash(ls)" }));
    await userEvent.click(screen.getByRole("button", { name: "Save permissions…" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "setPermissions",
      filePath: `${HOME}/.claude/settings.json`,
      defaultMode: "acceptEdits",
      allow: ["Read"],
      deny: ["Bash(rm -rf *)"],
    });
    expect(useStore.getState().preview?.options).toEqual({
      draftKey: "settings:claude:user",
      draftFields: ["perm.mode", "perm.custom", "perm.allow", "perm.deny"],
      subject: "settings.json permissions",
    });
  });

  it("supports unset and custom default modes", async () => {
    loadData(makeData({ entities: [settings({ rawText: '{ "permissions": { "defaultMode": "weird" } }' })] }));
    render(<SettingsView />);
    await userEvent.click(row("settings.json"));
    const mode = screen.getByLabelText("Permissions") as HTMLSelectElement;
    expect(mode.value).toBe("__custom__");
    expect((screen.getByLabelText("Custom defaultMode value") as HTMLInputElement).value).toBe("weird");
    await userEvent.type(screen.getByLabelText("Custom defaultMode value"), "er ");
    await userEvent.click(screen.getByRole("button", { name: "Save permissions…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith(expect.objectContaining({ defaultMode: "weirder" }));

    await userEvent.selectOptions(mode, "__unset__");
    expect(screen.queryByLabelText("Custom defaultMode value")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save permissions…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith(expect.objectContaining({ defaultMode: null, allow: [], deny: [] }));
  });

  it("starts unset when the file has no permissions block", async () => {
    loadData(makeData({ entities: [settings({ rawText: "{}", known: {} })] }));
    render(<SettingsView />);
    await userEvent.click(row("settings.json"));
    expect((screen.getByLabelText("Permissions") as HTMLSelectElement).value).toBe("__unset__");
    expect(screen.queryByText("Quick edit")).toBeNull();
  });

  it("hides the permissions form for non-Claude files and sets known keys via quick edit", async () => {
    loadData(makeData({ entities: [CODEX] }));
    render(<SettingsView />);
    await userEvent.click(row("config.toml"));
    expect(screen.queryByLabelText("Permissions")).toBeNull();
    expect(screen.getByText("Quick edit")).toBeTruthy();
    const value = screen.getByLabelText("Value of approval_policy") as HTMLInputElement;
    expect(value.value).toBe("never");
    await userEvent.clear(value);
    await userEvent.type(value, "on-request");
    await userEvent.click(screen.getAllByRole("button", { name: "Set…" })[1] as HTMLElement);
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "setSetting",
      filePath: `${HOME}/.codex/config.toml`,
      format: "toml",
      keyPath: ["approval_policy"],
      value: "on-request",
    });
    expect(useStore.getState().preview?.options).toEqual({
      draftKey: "settings:codex:user",
      draftFields: ["known.approval_policy"],
      subject: "approval_policy",
    });
  });

  it("parses quick-edit values as JSON when possible and splits dotted JSON keys", async () => {
    loadData(makeData({ entities: [settings({ known: { "permissions.defaultMode": "plan", model: "opus" } })] }));
    render(<SettingsView />);
    await userEvent.click(row("settings.json"));
    const value = screen.getByLabelText("Value of permissions.defaultMode") as HTMLInputElement;
    await userEvent.clear(value);
    await userEvent.type(value, "true");
    await userEvent.click(screen.getAllByRole("button", { name: "Set…" })[0] as HTMLElement);
    expect(cockpit().preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ op: "setSetting", format: "json", keyPath: ["permissions", "defaultMode"], value: true }),
    );
  });

  it("shows non-string known values as JSON", async () => {
    loadData(makeData({ entities: [settings({ known: { effortLevel: 3 } })] }));
    render(<SettingsView />);
    await userEvent.click(row("settings.json"));
    expect((screen.getByLabelText("Value of effortLevel") as HTMLInputElement).value).toBe("3");
  });

  it("saves the raw file from the editor and clears only the raw draft", async () => {
    loadData(makeData({ entities: [settings()] }));
    render(<SettingsView />);
    await userEvent.click(row("settings.json"));
    expect(screen.getByText("Raw file (json)")).toBeTruthy();
    const view = await rawEditor();
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "{}\n" } }));
    expect(within(row("settings.json")).getByText("unsaved")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Permissions"), "default");
    await userEvent.click(screen.getByRole("button", { name: "Save raw…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith({
      op: "writeRaw",
      filePath: `${HOME}/.claude/settings.json`,
      format: "json",
      newText: "{}\n",
    });
    expect(useStore.getState().preview?.options).toEqual({ draftKey: "settings:claude:user", draftFields: ["raw"], subject: "settings.json" });

    cockpit().apply.mockResolvedValueOnce({ status: "ok" });
    await act(() => useStore.getState().confirmApply());
    expect(useStore.getState().drafts["settings:claude:user"]).toEqual({ "perm.mode": "default" });
    expect(within(row("settings.json")).getByText("unsaved")).toBeTruthy();
  });

  it("reveals the file and closes the editor", async () => {
    loadData(makeData({ entities: [settings()] }));
    render(<SettingsView />);
    await userEvent.click(row("settings.json"));
    await userEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(cockpit().reveal).toHaveBeenCalledWith(`${HOME}/.claude/settings.json`);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: "Save raw…" })).toBeNull();
  });
});
