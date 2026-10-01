// Skills / Subagents / Commands: the shared markdown list+editor, the
// mutations it emits per kind, and the cross-agent skill comparison.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import type { SkillEntity } from "../../src/lib/model/types";
import { useStore } from "../../src/renderer/src/store";
import { MarkdownEntityView } from "../../src/renderer/src/views/MarkdownEntityView";
import { cockpit } from "./cockpit-mock";
import { HOME, PROJECT, command, makeData, project, skill, subagent } from "./fixtures";
import { loadData } from "./store-helpers";

/** The n-th list row titled `name` (same-named skills of different agents share a title). */
const row = (name: string, index = 0) =>
  (screen.getAllByText(name, { selector: "strong" })[index] as HTMLElement).closest("button") as HTMLButtonElement;

const CODEX_DEPLOY = skill({
  id: "skill:codex:user:deploy",
  agent: "codex",
  filePath: `${HOME}/.codex/skills/deploy/SKILL.md`,
  body: "# Deploy\n\nRun the OTHER deploy script.\n",
  version: "2",
});

/** The lazily loaded CodeMirror body editor, once its chunk has resolved. */
async function bodyEditor(): Promise<EditorView> {
  for (let i = 0; i < 50; i += 1) {
    const found = document.querySelector(".cm-editor");
    if (found) return EditorView.findFromDOM(found as HTMLElement) as EditorView;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error("editor did not mount");
}

function renderKind(kind: "skill" | "subagent" | "command", entities: SkillEntity[] | ReturnType<typeof subagent>[] | ReturnType<typeof command>[]): void {
  loadData(makeData({ entities, projects: [project()] }));
  render(<MarkdownEntityView kind={kind} />);
}

describe("MarkdownEntityView list", () => {
  it("shows a kind-specific empty state", () => {
    renderKind("subagent", []);
    expect(screen.getByText("No subagents found. Create one with “+ New”.")).toBeTruthy();
  });

  it("shows built-in, synced and differs tags with the description", () => {
    const identical = skill({ ...CODEX_DEPLOY, body: skill().body, version: undefined });
    renderKind("skill", [
      skill(),
      identical,
      skill({ id: "ro", name: "builtin", readOnly: true, filePath: `${HOME}/.claude/skills/builtin/SKILL.md`, description: "Ships with the app" }),
      skill({ id: "lint-c", name: "lint", filePath: `${HOME}/.claude/skills/lint/SKILL.md`, body: "a" }),
      skill({ id: "lint-x", name: "lint", agent: "cursor", filePath: `${HOME}/.cursor/skills/lint/SKILL.md`, body: "b" }),
    ]);
    expect(within(row("deploy")).getByText("≡ synced")).toBeTruthy();
    expect(within(row("builtin")).getByText("built-in")).toBeTruthy();
    expect(within(row("builtin")).getByText("Ships with the app")).toBeTruthy();
    expect(within(row("lint")).getByText("≠ differs")).toBeTruthy();
  });
});

describe("Skill editor", () => {
  it("creates a skill in the chosen location after validating name and description", async () => {
    renderKind("skill", []);
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    expect(screen.getByRole("heading", { name: "New skill" })).toBeTruthy();
    const location = screen.getByLabelText("Location") as HTMLSelectElement;
    expect(Array.from(location.options).map((o) => o.text)).toEqual([
      "Claude Code — user (~/.claude/skills)",
      "Codex — user (~/.codex/skills)",
      "Cursor — user (~/.cursor/skills)",
      "demo-app — project (.claude/skills)",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(screen.getByRole("alert").textContent).toContain("name is required");
    expect(screen.getByRole("alert").textContent).toContain("description is required");

    await userEvent.selectOptions(location, "3");
    await userEvent.type(screen.getByLabelText("Name"), "bad name");
    await userEvent.type(screen.getByLabelText("Description"), " Does things ");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(screen.getByRole("alert").textContent).toContain("name may only contain letters, digits, dot, dash and underscore");

    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "release ");
    await userEvent.type(screen.getByLabelText("Version (optional)"), " ");
    const view = await bodyEditor();
    act(() => view.dispatch({ changes: { from: 0, insert: "# Release\n" } }));
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "upsertSkill",
      dir: `${PROJECT}/.claude/skills`,
      name: "release",
      prevName: undefined,
      description: "Does things",
      version: undefined,
      body: "# Release\n",
    });
    expect(useStore.getState().preview?.options).toEqual({ draftKey: "new:skill", subject: "release" });
  });

  it("edits an existing skill, keeping the directory name as prevName, and previews deletion", async () => {
    renderKind("skill", [skill({ name: "Deploy Tool", frontmatterExtras: { icon: "rocket" } })]);
    await userEvent.click(row("Deploy Tool"));
    expect(screen.getByRole("heading", { name: "Edit: Deploy Tool" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("deploy");
    expect(screen.getByText("Other frontmatter keys (preserved as-is)")).toBeTruthy();
    expect(screen.getByText(/"icon": "rocket"/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Version (optional)"), "1.0");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "upsertSkill",
      dir: `${HOME}/.claude/skills`,
      name: "deploy",
      prevName: "deploy",
      description: "Deploy the app",
      version: "1.0",
      body: skill().body,
    });

    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith({
      op: "deleteSkill",
      filePath: `${HOME}/.claude/skills/deploy/SKILL.md`,
      skillDir: `${HOME}/.claude/skills/deploy`,
    });
    expect(useStore.getState().preview?.options).toEqual({ draftKey: "skill:claude:user:deploy", subject: "Deploy Tool" });
  });

  it("shows built-in skills read-only", async () => {
    renderKind("skill", [skill({ name: "builtin", readOnly: true })]);
    await userEvent.click(row("builtin"));
    expect(screen.getByRole("heading", { name: "View: builtin" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Save…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
    const view = await bodyEditor();
    expect(view.state.readOnly).toBe(true);
  });

  it("keeps body edits as a draft and marks the row", async () => {
    renderKind("skill", [skill()]);
    await userEvent.click(row("deploy"));
    const view = await bodyEditor();
    act(() => view.dispatch({ changes: { from: 0, insert: "Edited " } }));
    expect(within(row("deploy")).getByText("unsaved")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(row("deploy"));
    expect((await bodyEditor()).state.doc.toString().startsWith("Edited ")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect((await bodyEditor()).state.doc.toString()).toBe(skill().body);
  });
});

describe("Skill comparison", () => {
  it("diffs against the counterpart and copies in either direction", async () => {
    renderKind("skill", [skill(), CODEX_DEPLOY]);
    await userEvent.click(row("deploy"));
    const compare = screen.getByText("Compare across agents").parentElement as HTMLElement;
    expect(within(compare).getByText("≠ differs")).toBeTruthy();
    expect(screen.getByText("- Run the OTHER deploy script.")).toBeTruthy();
    expect(screen.getByText("+ Run the deploy script.")).toBeTruthy();
    expect(screen.getByText("- version: \"2\"")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Copy to Codex…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith({
      op: "upsertSkill",
      dir: `${HOME}/.codex/skills`,
      name: "deploy",
      prevName: "deploy",
      description: "Deploy the app",
      version: undefined,
      body: skill().body,
    });
    await userEvent.click(screen.getByRole("button", { name: "Copy from Codex…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith({
      op: "upsertSkill",
      dir: `${HOME}/.claude/skills`,
      name: "deploy",
      prevName: "deploy",
      description: "Deploy the app",
      version: "2",
      body: CODEX_DEPLOY.body,
    });
  });

  it("disables copying when the counterpart is identical", async () => {
    renderKind("skill", [skill(), skill({ ...CODEX_DEPLOY, body: skill().body, version: undefined })]);
    await userEvent.click(row("deploy"));
    const compare = screen.getByText("Compare across agents").parentElement as HTMLElement;
    expect(within(compare).getByText("≡ synced")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Copy to Codex…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Copy from Codex…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets the user pick between several counterparts", async () => {
    const cursor = skill({ ...CODEX_DEPLOY, id: "skill:cursor:deploy", agent: "cursor", filePath: `${HOME}/.cursor/skills/deploy/SKILL.md`, body: skill().body, version: undefined });
    renderKind("skill", [skill(), CODEX_DEPLOY, cursor]);
    await userEvent.click(row("deploy"));
    const picker = screen.getAllByRole("combobox").find((el) => el.textContent?.includes("differs")) as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.text)).toEqual(["Codex (differs)", "Cursor (synced)"]);
    await userEvent.selectOptions(picker, "1");
    expect(screen.getByRole("button", { name: "Copy to Cursor…" })).toBeTruthy();
    const compare = screen.getByText("Compare across agents").parentElement as HTMLElement;
    expect(within(compare).getByText("≡ synced")).toBeTruthy();
  });

  it("offers to copy to agents that lack the skill", async () => {
    renderKind("skill", [skill()]);
    await userEvent.click(row("deploy"));
    expect(screen.getByText("No counterpart in other agents.")).toBeTruthy();
    const target = screen.getAllByRole("combobox").find((el) => el.textContent?.includes("Codex")) as HTMLSelectElement;
    expect(Array.from(target.options).map((o) => o.text)).toEqual(["Codex", "Cursor"]);
    await userEvent.selectOptions(target, "cursor");
    await userEvent.click(screen.getByRole("button", { name: "Copy to…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ op: "upsertSkill", dir: `${HOME}/.cursor/skills`, name: "deploy", body: skill().body }),
    );
  });

  it("hides the copy target when every other agent already has the skill", async () => {
    const cursor = skill({ ...CODEX_DEPLOY, id: "skill:cursor:deploy", agent: "cursor", filePath: `${HOME}/.cursor/skills/deploy/SKILL.md` });
    renderKind("skill", [skill(), CODEX_DEPLOY, cursor]);
    await userEvent.click(row("deploy"));
    expect(screen.queryByRole("button", { name: "Copy to…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy to Codex…" })).toBeTruthy();
  });

  it("shows nothing to compare for project-scope skills", async () => {
    renderKind("skill", [skill({ scope: { level: "project", projectPath: PROJECT }, filePath: `${PROJECT}/.claude/skills/deploy/SKILL.md` })]);
    await userEvent.click(row("deploy"));
    expect(screen.getByText("No counterpart in other agents.")).toBeTruthy();
  });
});

describe("Subagent editor", () => {
  it("creates a subagent with optional tools and model", async () => {
    renderKind("subagent", []);
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    const location = screen.getByLabelText("Location") as HTMLSelectElement;
    expect(Array.from(location.options).map((o) => o.text)).toEqual([
      "Claude Code — user (~/.claude/agents)",
      "Cursor — user (~/.cursor/agents)",
      "demo-app — project (.claude/agents)",
    ]);
    await userEvent.type(screen.getByLabelText("Name"), "planner");
    await userEvent.type(screen.getByLabelText("Description"), "Plans work");
    await userEvent.type(screen.getByLabelText("Tools (comma-separated, optional)"), " Read, Grep ");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "upsertMarkdown",
      kind: "subagent",
      dir: `${HOME}/.claude/agents`,
      name: "planner",
      prevName: undefined,
      frontmatter: { name: "planner", description: "Plans work", tools: "Read, Grep", model: undefined },
      body: "",
    });
  });

  it("edits an existing subagent and deletes its file", async () => {
    renderKind("subagent", [subagent({ tools: "Bash", model: "fast" })]);
    await userEvent.click(row("reviewer"));
    expect((screen.getByLabelText("Model (optional)") as HTMLInputElement).value).toBe("fast");
    await userEvent.clear(screen.getByLabelText("Model (optional)"));
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "upsertMarkdown",
      kind: "subagent",
      dir: `${HOME}/.claude/agents`,
      name: "reviewer",
      prevName: "reviewer",
      frontmatter: { name: "reviewer", description: "Reviews code", tools: "Bash", model: undefined },
      body: "You review code.\n",
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith({ op: "deleteFile", filePath: `${HOME}/.claude/agents/reviewer.md` });
  });
});

describe("Command editor", () => {
  it("omits an empty description from the frontmatter", async () => {
    renderKind("command", []);
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    const location = screen.getByLabelText("Location") as HTMLSelectElement;
    expect(Array.from(location.options).map((o) => o.text)).toEqual([
      "Claude Code — user (~/.claude/commands)",
      "demo-app — project (.claude/commands)",
    ]);
    await userEvent.type(screen.getByLabelText("Name"), "review");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "upsertMarkdown",
      kind: "command",
      dir: `${HOME}/.claude/commands`,
      name: "review",
      prevName: undefined,
      frontmatter: { description: undefined },
      body: "",
    });
  });

  it("keeps a command's description and reveals its file", async () => {
    renderKind("command", [command()]);
    await userEvent.click(row("ship"));
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Ship it");
    await userEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(cockpit().reveal).toHaveBeenCalledWith(`${HOME}/.claude/commands/ship.md`);
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith(
      expect.objectContaining({ op: "upsertMarkdown", kind: "command", prevName: "ship", frontmatter: { description: "Ship it" } }),
    );
  });

  it("clamps a stale draft location so the select and the save agree", async () => {
    renderKind("command", []);
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    await userEvent.type(screen.getByLabelText("Name"), "x");
    act(() => useStore.getState().setDraftField("new:command", "dirIndex", 42));
    expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe("1");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith(expect.objectContaining({ dir: `${PROJECT}/.claude/commands` }));
  });
});
