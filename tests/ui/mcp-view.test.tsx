// MCP Servers view: list rendering, the create/edit form, validation, the
// mutations it emits, the connection test and the .mcp.json approval switch.

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MASK } from "../../src/lib/redact";
import { useStore } from "../../src/renderer/src/store";
import { McpView } from "../../src/renderer/src/views/McpView";
import { cockpit } from "./cockpit-mock";
import { HOME, PROJECT, makeData, mcp, project } from "./fixtures";
import { loadData } from "./store-helpers";

const HTTP = mcp({
  id: "mcp:cursor:remote",
  agent: "cursor",
  name: "remote",
  source: { kind: "cursor" },
  filePath: `${HOME}/.cursor/mcp.json`,
  transport: "http",
  command: undefined,
  args: undefined,
  url: "https://example.test/mcp",
  headers: { Authorization: "Bearer abcd1234" },
  extras: { note: "keep" },
});

const PROJECT_MCPJSON = mcp({
  id: "mcp:mcpjson:demo:shared",
  name: "shared",
  source: { kind: "mcpjson" },
  scope: { level: "project", projectPath: PROJECT },
  filePath: `${PROJECT}/.mcp.json`,
  enabled: undefined,
});

function renderView(entities = [mcp(), HTTP, PROJECT_MCPJSON], projects = [project()]): void {
  loadData(makeData({ entities, projects }));
  render(<McpView />);
}

const row = (name: string) => screen.getByText(name, { selector: "strong" }).closest("button") as HTMLButtonElement;

describe("McpView list", () => {
  it("shows the empty state without servers", () => {
    renderView([]);
    expect(screen.getByText("No MCP servers found.")).toBeTruthy();
  });

  it("renders one row per server with agent, scope, transport and a command/url summary", () => {
    renderView();
    const alpha = row("alpha");
    expect(alpha.textContent).toContain("Claude Code");
    expect(alpha.textContent).toContain("user");
    expect(alpha.textContent).toContain("stdio");
    expect(alpha.textContent).toContain("npx -y @demo/alpha");
    expect(row("remote").textContent).toContain("https://example.test/mcp");
    expect(row("shared").textContent).toContain("unapproved");
    expect(row("shared").textContent).toContain("demo-app");
  });

  it("marks disabled .mcp.json servers", () => {
    renderView([mcp({ ...PROJECT_MCPJSON, enabled: false })]);
    expect(row("shared").textContent).toContain("disabled");
    expect(row("shared").textContent).not.toContain("unapproved");
  });

  it("respects the agent filter", () => {
    loadData(makeData({ entities: [mcp(), HTTP] }));
    act(() => useStore.getState().setAgentFilter("cursor"));
    render(<McpView />);
    expect(screen.queryByText("alpha", { selector: "strong" })).toBeNull();
    expect(row("remote")).toBeTruthy();
  });
});

describe("McpView editor", () => {
  it("opens an existing server for editing, marks the row and closes again", async () => {
    renderView();
    await userEvent.click(row("alpha"));
    expect(screen.getByRole("heading", { name: "Edit: alpha" })).toBeTruthy();
    expect(row("alpha").getAttribute("aria-current")).toBe("true");
    expect(screen.getByText(`${HOME}/.claude.json`)).toBeTruthy();
    expect((screen.getByLabelText("Command") as HTMLInputElement).value).toBe("npx");
    expect((screen.getByLabelText("Arguments (one per line)") as HTMLTextAreaElement).value).toBe("-y\n@demo/alpha");
    await userEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(cockpit().reveal).toHaveBeenCalledWith(`${HOME}/.claude.json`);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Edit: alpha" })).toBeNull();
  });

  it("validates before previewing and lists every problem", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    expect(screen.getByRole("heading", { name: "New MCP server" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("name is required");
    expect(alert.textContent).toContain("command is required for stdio servers");
    expect(cockpit().preview).not.toHaveBeenCalled();
  });

  it("previews an upsert into the chosen target with trimmed, line-split input", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    const target = screen.getByLabelText("Write to") as HTMLSelectElement;
    expect(Array.from(target.options).map((o) => o.text)).toEqual([
      "Claude Code — user (~/.claude.json)",
      "Codex — user (~/.codex/config.toml)",
      "Cursor — user (~/.cursor/mcp.json)",
      "demo-app — .mcp.json (repo-shared)",
      "demo-app — Cursor (.cursor/mcp.json)",
    ]);
    await userEvent.selectOptions(target, "3");
    await userEvent.type(screen.getByLabelText("Name"), " gamma ");
    await userEvent.type(screen.getByLabelText("Command"), "node ");
    await userEvent.type(screen.getByLabelText("Arguments (one per line)"), "server.js\n\n --port ");
    await userEvent.click(screen.getByRole("button", { name: "+ add" }));
    await userEvent.type(screen.getByLabelText("Environment variables name 1"), "API_KEY");
    await userEvent.click(screen.getByRole("button", { name: "Show value of API_KEY" }));
    await userEvent.type(screen.getByLabelText("Value of API_KEY"), "sk-secret-value");
    expect(screen.getByText("env/header values are masked in the diff")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "upsertMcp",
      target: { kind: "mcpjson", filePath: `${PROJECT}/.mcp.json` },
      prevName: undefined,
      input: {
        name: "gamma",
        transport: "stdio",
        command: "node",
        args: ["server.js", "--port"],
        env: { API_KEY: "sk-secret-value" },
        url: undefined,
        headers: undefined,
        startupTimeoutSec: undefined,
        extras: {},
      },
    });
    expect(useStore.getState().preview?.options).toEqual({ draftKey: "new:mcp", subject: "gamma" });
  });

  it("switches to url/headers for remote transports and drops blank header names", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    await userEvent.selectOptions(screen.getByLabelText("Transport"), "http");
    expect(screen.queryByLabelText("Command")).toBeNull();
    await userEvent.type(screen.getByLabelText("Name"), "hosted");
    await userEvent.type(screen.getByLabelText("URL"), "ftp://nope");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(screen.getByRole("alert").textContent).toContain("a valid http(s) url is required for remote servers");

    await userEvent.clear(screen.getByLabelText("URL"));
    await userEvent.type(screen.getByLabelText("URL"), "https://api.test/mcp");
    await userEvent.click(screen.getByRole("button", { name: "+ add" }));
    await userEvent.click(screen.getByRole("button", { name: "+ add" }));
    await userEvent.type(screen.getByLabelText("Headers name 1"), "X-Env");
    await userEvent.click(screen.getByRole("button", { name: "Show value of X-Env" }));
    await userEvent.type(screen.getByLabelText("Value of X-Env"), "prod");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(screen.queryByRole("alert")).toBeNull();
    const call = cockpit().preview.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      op: "upsertMcp",
      input: { transport: "http", url: "https://api.test/mcp", headers: { "X-Env": "prod" }, command: undefined, env: undefined },
    });
  });

  it("offers a startup timeout only for Codex targets and sends it as a number", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    expect(screen.queryByLabelText("Startup timeout (sec)")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Write to"), "1");
    await userEvent.type(screen.getByLabelText("Name"), "cx");
    await userEvent.type(screen.getByLabelText("Command"), "uvx");
    await userEvent.type(screen.getByLabelText("Startup timeout (sec)"), "-1");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(screen.getByRole("alert").textContent).toContain("startup timeout must be a positive number of seconds");
    await userEvent.clear(screen.getByLabelText("Startup timeout (sec)"));
    await userEvent.type(screen.getByLabelText("Startup timeout (sec)"), "30");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: { kind: "codex", filePath: `${HOME}/.codex/config.toml` },
        input: expect.objectContaining({ startupTimeoutSec: 30 }),
      }),
    );
  });

  it("edits an existing remote server, keeps its extras and previews a rename", async () => {
    renderView();
    await userEvent.click(row("remote"));
    expect(screen.getByText("Other keys (preserved as-is)")).toBeTruthy();
    expect(screen.getByText(/"note": "keep"/)).toBeTruthy();
    const authValue = screen.getByLabelText("Value of Authorization") as HTMLInputElement;
    expect(authValue.value).toBe(MASK);
    expect(authValue.type).toBe("password");
    await userEvent.click(screen.getByRole("button", { name: "Show value of Authorization" }));
    expect((screen.getByLabelText("Value of Authorization") as HTMLInputElement).value).toBe("Bearer abcd1234");
    await userEvent.click(screen.getByRole("button", { name: "Hide value of Authorization" }));
    expect((screen.getByLabelText("Value of Authorization") as HTMLInputElement).value).toBe(MASK);

    await userEvent.type(screen.getByLabelText("Name"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "upsertMcp",
      target: { kind: "cursor", filePath: `${HOME}/.cursor/mcp.json` },
      prevName: "remote",
      input: expect.objectContaining({ name: "remote2", url: "https://example.test/mcp", headers: { Authorization: "Bearer abcd1234" }, extras: { note: "keep" } }),
    });
  });

  it("removes env rows and renames keys in place", async () => {
    renderView([mcp({ env: { A: "1", B: "2" } })]);
    await userEvent.click(row("alpha"));
    await userEvent.click(screen.getByRole("button", { name: "Remove A" }));
    expect(screen.queryByLabelText("Value of A")).toBeNull();
    const nameInput = screen.getByLabelText("Environment variables name 1") as HTMLInputElement;
    expect(nameInput.value).toBe("B");
    await userEvent.type(nameInput, "2");
    expect(screen.getByLabelText("Value of B2")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ env: { B2: "2" } }) }));
  });

  it("previews a delete for editable servers and hides Delete for read-only ones", async () => {
    renderView([mcp(), mcp({ id: "ro", name: "builtin", readOnly: true })]);
    await userEvent.click(row("alpha"));
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "deleteMcp",
      target: { kind: "claude-user", filePath: `${HOME}/.claude.json` },
      name: "alpha",
    });
    expect(useStore.getState().preview?.options).toEqual({ draftKey: "mcp:claude-user:alpha", subject: "alpha" });
    await userEvent.click(row("builtin"));
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
  });

  it("targets the project entry of ~/.claude.json for claude-project servers", async () => {
    renderView([mcp({ id: "p", name: "proj", source: { kind: "claude-project", projectPath: PROJECT }, scope: { level: "project", projectPath: PROJECT } })]);
    await userEvent.click(row("proj"));
    await userEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(cockpit().preview).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "claude-project", filePath: `${HOME}/.claude.json`, projectPath: PROJECT } }),
    );
  });

  it("toggles Claude Code approval for repo-shared servers", async () => {
    renderView();
    await userEvent.click(row("shared"));
    const approval = screen.getByRole("switch", { name: "Claude Code approval for shared" });
    expect(approval.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Off")).toBeTruthy();
    await userEvent.click(approval);
    expect(cockpit().preview).toHaveBeenCalledWith({
      op: "toggleMcpJsonServer",
      claudeJsonPath: `${HOME}/.claude.json`,
      projectPath: PROJECT,
      name: "shared",
      enabled: true,
    });
    await userEvent.click(row("alpha"));
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("switches an approved server off", async () => {
    renderView([mcp({ ...PROJECT_MCPJSON, enabled: true })]);
    await userEvent.click(row("shared"));
    expect(screen.getByText("On")).toBeTruthy();
    await userEvent.click(screen.getByRole("switch"));
    expect(cockpit().preview).toHaveBeenCalledWith(expect.objectContaining({ op: "toggleMcpJsonServer", enabled: false }));
  });

  it("runs the connection test against the current form and reports the outcome", async () => {
    renderView();
    await userEvent.click(row("alpha"));
    let finish: (r: { ok: boolean; phase: "protocol"; detail: string; elapsedMs: number }) => void = () => {};
    cockpit().mcpTest.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect((screen.getByRole("button", { name: "Testing…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ ok: true, phase: "protocol", detail: "demo 1.0", elapsedMs: 42 }));
    expect(screen.getByText("✓ initialize OK — demo 1.0 (42ms)")).toBeTruthy();
    expect(cockpit().mcpTest).toHaveBeenCalledWith(expect.objectContaining({ name: "alpha", command: "npx", args: ["-y", "@demo/alpha"] }));

    cockpit().mcpTest.mockResolvedValueOnce({ ok: false, phase: "timeout", detail: "no response", elapsedMs: 10000 });
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByText("✗ timeout: no response (10000ms)")).toBeTruthy();
  });

  it("refuses to test an invalid form", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByRole("alert").textContent).toContain("name is required");
    expect(cockpit().mcpTest).not.toHaveBeenCalled();
  });

  it("keeps unsaved input across navigation, flags the row and discards undoably", async () => {
    renderView();
    await userEvent.click(row("alpha"));
    await userEvent.type(screen.getByLabelText("Name"), "-edited");
    expect(within(row("alpha")).getByText("unsaved")).toBeTruthy();
    await userEvent.click(row("remote"));
    await userEvent.click(row("alpha"));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("alpha-edited");
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("alpha");
    expect(within(row("alpha")).queryByText("unsaved")).toBeNull();
    act(() => useStore.getState().toast?.action?.run());
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("alpha-edited");
  });

  it("clamps a stale draft target index so the select and the save agree", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    await userEvent.type(screen.getByLabelText("Name"), "z");
    await userEvent.type(screen.getByLabelText("Command"), "z");
    act(() => useStore.getState().setDraftField("new:mcp", "targetIndex", 99));
    expect((screen.getByLabelText("Write to") as HTMLSelectElement).value).toBe("4");
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect(cockpit().preview).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "cursor", filePath: `${PROJECT}/.cursor/mcp.json` } }),
    );
  });
});
