// Main process entry: IPC handlers, the file watcher, window lifecycle and
// the update check — with electron and chokidar mocked and a synthetic home
// directory on disk. Each test boots a fresh module instance.

import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mutation } from "../src/lib/mutations";
import { CHANNELS, type ApplyResult, type PreviewResult, type ScanResultPayload, type UpdateCheckResult } from "../src/shared/ipc";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  const home = `${(process.env["TMPDIR"] ?? "/tmp").replace(/\/+$/, "")}/cockpit-main-${process.pid}`;
  const state = {
    home,
    userData: `${home}/userData`,
    handlers: new Map<string, Handler>(),
    appEvents: new Map<string, (...args: unknown[]) => void>(),
    themeEvents: new Map<string, () => void>(),
    windows: [] as MockWindow[],
    watchers: [] as MockWatcher[],
    dark: true,
    openDialog: null as null | (() => Promise<{ canceled: boolean; filePaths: string[] }>),
    probeStdio: null as null | ((...args: unknown[]) => Promise<unknown>),
    probeHttp: null as null | ((...args: unknown[]) => Promise<unknown>),
    shellShow: [] as string[],
    shellOpen: [] as string[],
    permissionHandler: null as null | ((wc: unknown, permission: string, cb: (granted: boolean) => void) => void),
    quit: 0,
  };
  class MockWatcher {
    listeners = new Map<string, () => void>();
    closed = false;
    paths: string[] = [];
    options: { ignored: (p: string) => boolean } = { ignored: () => false };
    on(event: string, cb: () => void): this {
      this.listeners.set(event, cb);
      return this;
    }
    async close(): Promise<void> {
      this.closed = true;
    }
  }
  class MockWindow {
    static all: MockWindow[] = [];
    options: Record<string, unknown>;
    events = new Map<string, (...args: unknown[]) => void>();
    sent: string[] = [];
    loaded: string[] = [];
    backgrounds: string[] = [];
    bounds = { x: 10, y: 20, width: 1000, height: 700 };
    webContents = {
      send: (channel: string) => this.sent.push(channel),
      setWindowOpenHandler: (fn: () => { action: string }) => (this.openHandler = fn),
      on: (event: string, fn: (e: { preventDefault: () => void }) => void) => this.wcEvents.set(event, fn),
    };
    openHandler: (() => { action: string }) | null = null;
    wcEvents = new Map<string, (e: { preventDefault: () => void }) => void>();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.windows.push(this);
    }
    on(event: string, fn: (...args: unknown[]) => void): void {
      this.events.set(event, fn);
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return this.bounds;
    }
    async loadFile(p: string): Promise<void> {
      this.loaded.push(p);
    }
    async loadURL(u: string): Promise<void> {
      this.loaded.push(u);
    }
    setBackgroundColor(c: string): void {
      this.backgrounds.push(c);
    }
    static getAllWindows(): MockWindow[] {
      return MockWindow.all;
    }
  }
  return { ...state, MockWatcher, MockWindow };
});

vi.mock("electron", () => ({
  app: {
    getPath: () => h.userData,
    getVersion: () => "0.1.0",
    whenReady: () => Promise.resolve(),
    on: (event: string, cb: (...args: unknown[]) => void) => h.appEvents.set(event, cb),
    quit: () => (h.quit += 1),
  },
  BrowserWindow: h.MockWindow,
  dialog: { showOpenDialog: () => (h.openDialog as () => Promise<{ canceled: boolean; filePaths: string[] }>)() },
  ipcMain: { handle: (channel: string, fn: Handler) => h.handlers.set(channel, fn) },
  nativeTheme: {
    get shouldUseDarkColors() {
      return h.dark;
    },
    on: (event: string, cb: () => void) => h.themeEvents.set(event, cb),
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: (fn: (wc: unknown, permission: string, cb: (granted: boolean) => void) => void) =>
        (h.permissionHandler = fn),
    },
  },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  shell: { showItemInFolder: (p: string) => h.shellShow.push(p), openExternal: async (u: string) => h.shellOpen.push(u) },
}));

vi.mock("chokidar", () => ({
  default: {
    watch: (paths: string[], options: { ignored: (p: string) => boolean }) => {
      const w = new h.MockWatcher();
      w.paths = paths;
      w.options = options;
      h.watchers.push(w);
      return w;
    },
  },
}));

vi.mock("node:os", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:os")>()), homedir: () => h.home }));

vi.mock("../src/main/mcp-probe", () => ({
  probeStdio: (...args: unknown[]) => (h.probeStdio as (...a: unknown[]) => Promise<unknown>)(...args),
  probeHttp: (...args: unknown[]) => (h.probeHttp as (...a: unknown[]) => Promise<unknown>)(...args),
}));

const RELEASES = "https://github.com/tktk7l9/agent-cockpit/releases/latest";
const claudeMd = () => path.join(h.home, ".claude", "CLAUDE.md");

function call<T>(channel: string, ...args: unknown[]): T {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({}, ...args) as T;
}

function writeHome(rel: string, text: string): string {
  const full = path.join(h.home, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

async function boot(): Promise<void> {
  vi.resetModules();
  h.handlers.clear();
  h.appEvents.clear();
  h.themeEvents.clear();
  h.windows.length = 0;
  h.watchers.length = 0;
  h.MockWindow.all = [];
  h.shellShow.length = 0;
  h.shellOpen.length = 0;
  h.quit = 0;
  await import("../src/main/index");
  await flush();
}

const WRITE = (): Mutation => ({ op: "writeRaw", filePath: claudeMd(), format: "markdown", newText: "# v2\n" });

beforeAll(() => {
  fs.mkdirSync(h.home, { recursive: true });
});

afterAll(() => {
  fs.rmSync(h.home, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(h.home, { recursive: true, force: true });
  fs.mkdirSync(h.home, { recursive: true });
  h.dark = true;
  h.openDialog = async () => ({ canceled: true, filePaths: [] });
  h.probeStdio = async () => ({ ok: true, phase: "protocol", detail: "stdio", elapsedMs: 1 });
  h.probeHttp = async () => ({ ok: true, phase: "protocol", detail: "http", elapsedMs: 1 });
  delete process.env["ELECTRON_RENDERER_URL"];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startup", () => {
  it("registers every IPC channel, creates the window with defaults and starts watching", async () => {
    await boot();
    const expected = Object.values(CHANNELS).filter((c) => c !== CHANNELS.changed);
    expect([...h.handlers.keys()].sort()).toEqual(expected.sort());
    expect(h.windows).toHaveLength(1);
    const win = h.windows[0] as InstanceType<typeof h.MockWindow>;
    expect(win.options).toMatchObject({ width: 1280, height: 820, backgroundColor: "#101418" });
    expect((win.options["webPreferences"] as Record<string, unknown>)["contextIsolation"]).toBe(true);
    expect((win.options["webPreferences"] as Record<string, unknown>)["sandbox"]).toBe(true);
    expect(win.loaded[0]).toMatch(/renderer\/index\.html$/);
    expect(win.openHandler?.()).toEqual({ action: "deny" });
    const prevent = vi.fn();
    win.wcEvents.get("will-navigate")?.({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
    const grant = vi.fn();
    h.permissionHandler?.({}, "media", grant);
    expect(grant).toHaveBeenCalledWith(false);
    expect(h.watchers).toHaveLength(1);
  });

  it("restores saved window bounds when they are on screen, uses the light background and the dev url", async () => {
    fs.mkdirSync(h.userData, { recursive: true });
    fs.writeFileSync(path.join(h.userData, "app-config.json"), JSON.stringify({ projects: [], windowBounds: { x: 5, y: 5, width: 900, height: 650 } }));
    h.dark = false;
    process.env["ELECTRON_RENDERER_URL"] = "http://localhost:5173";
    await boot();
    const win = h.windows[0] as InstanceType<typeof h.MockWindow>;
    expect(win.options).toMatchObject({ x: 5, y: 5, width: 900, height: 650, backgroundColor: "#f5f7fa" });
    expect(win.loaded).toEqual(["http://localhost:5173"]);
  });

  it("ignores saved bounds that are off screen", async () => {
    fs.mkdirSync(h.userData, { recursive: true });
    fs.writeFileSync(path.join(h.userData, "app-config.json"), JSON.stringify({ projects: [], windowBounds: { x: 9000, y: 9000, width: 900, height: 650 } }));
    await boot();
    expect((h.windows[0] as InstanceType<typeof h.MockWindow>).options).toMatchObject({ width: 1280, height: 820 });
  });
});

describe("window lifecycle", () => {
  it("saves bounds after resize/move settle and on close, and follows the OS theme", async () => {
    await boot();
    vi.useFakeTimers();
    const win = h.windows[0] as InstanceType<typeof h.MockWindow>;
    win.bounds = { x: 1, y: 2, width: 901, height: 601 };
    win.events.get("resize")?.();
    win.events.get("move")?.();
    vi.advanceTimersByTime(499);
    expect(fs.existsSync(path.join(h.userData, "app-config.json"))).toBe(false);
    vi.advanceTimersByTime(1);
    expect(JSON.parse(fs.readFileSync(path.join(h.userData, "app-config.json"), "utf8")).windowBounds).toEqual(win.bounds);

    win.bounds = { x: 3, y: 4, width: 902, height: 602 };
    win.events.get("resize")?.();
    win.events.get("close")?.();
    expect(JSON.parse(fs.readFileSync(path.join(h.userData, "app-config.json"), "utf8")).windowBounds).toEqual(win.bounds);
    vi.advanceTimersByTime(1000);

    h.dark = false;
    h.themeEvents.get("updated")?.();
    expect(win.backgrounds).toEqual(["#f5f7fa"]);
  });

  it("recreates a window on activate only when none is open, and quits when all close", async () => {
    await boot();
    h.MockWindow.all = [h.windows[0] as InstanceType<typeof h.MockWindow>];
    h.appEvents.get("activate")?.();
    expect(h.windows).toHaveLength(1);
    h.MockWindow.all = [];
    h.appEvents.get("activate")?.();
    expect(h.windows).toHaveLength(2);
    h.appEvents.get("window-all-closed")?.();
    expect(h.quit).toBe(1);
  });

  it("stops saving bounds and refuses the folder picker once the window is gone", async () => {
    await boot();
    const win = h.windows[0] as InstanceType<typeof h.MockWindow>;
    win.events.get("closed")?.();
    win.events.get("close")?.();
    expect(fs.existsSync(path.join(h.userData, "app-config.json"))).toBe(false);
    h.themeEvents.get("updated")?.();
    expect(win.backgrounds).toEqual([]);
    expect(await call<Promise<unknown>>(CHANNELS.addProject)).toBeNull();
  });
});

describe("watcher", () => {
  it("watches the home config paths but never auth.json or .env files", async () => {
    await boot();
    const watcher = h.watchers[0] as InstanceType<typeof h.MockWatcher>;
    expect(watcher.paths).toContain(path.join(h.home, ".claude.json"));
    expect(watcher.paths).toContain(path.join(h.home, ".codex", "skills"));
    expect(watcher.options.ignored(path.join(h.home, ".codex", "auth.json"))).toBe(true);
    expect(watcher.options.ignored(path.join(h.home, ".claude", ".env.local"))).toBe(true);
    expect(watcher.options.ignored(path.join(h.home, ".claude", "settings.json"))).toBe(false);
  });

  it("debounces change notifications into one renderer event", async () => {
    await boot();
    vi.useFakeTimers();
    const watcher = h.watchers[0] as InstanceType<typeof h.MockWatcher>;
    watcher.listeners.get("all")?.();
    watcher.listeners.get("all")?.();
    vi.advanceTimersByTime(299);
    expect((h.windows[0] as InstanceType<typeof h.MockWindow>).sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect((h.windows[0] as InstanceType<typeof h.MockWindow>).sent).toEqual([CHANNELS.changed]);
  });
});

describe("scan / preview / apply / undo", () => {
  it("scans the home directory with the app version", async () => {
    writeHome(".claude/CLAUDE.md", "# rules");
    await boot();
    const result = await call<Promise<ScanResultPayload>>(CHANNELS.scan);
    expect(result.version).toBe("0.1.0");
    expect(result.home).toBe(h.home);
    expect(result.entities.map((e) => e.kind)).toEqual(["instructions"]);
  });

  it("previews a write as a diff with base hashes, and rejects paths outside the allowlist", async () => {
    writeHome(".claude/CLAUDE.md", "# v1\n");
    await boot();
    const preview = call<PreviewResult>(CHANNELS.preview, WRITE());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.files).toHaveLength(1);
    expect(preview.files[0]).toMatchObject({ path: claudeMd(), creates: false, deletes: false });
    expect(preview.files[0]?.baseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.files[0]?.diff.map((l) => `${l.type}:${l.text}`)).toEqual(["del:# v1", "add:# v2"]);

    const denied = call<PreviewResult>(CHANNELS.preview, { ...WRITE(), filePath: `${h.home}/elsewhere.md` });
    expect(denied).toEqual({ ok: false, error: `path not allowed: ${h.home}/elsewhere.md` });
  });

  it("rejects a skill delete whose directory does not contain the deleted file", async () => {
    const skillFile = writeHome(".claude/skills/a/SKILL.md", "---\nname: a\n---\n");
    fs.mkdirSync(path.join(h.home, "Documents", "empty"), { recursive: true });
    await boot();
    const outside = path.join(h.home, "Documents", "empty");
    const mutation: Mutation = { op: "deleteSkill", filePath: skillFile, skillDir: outside };
    expect(call<PreviewResult>(CHANNELS.preview, mutation)).toEqual({ ok: false, error: `directory not allowed for: ${skillFile}` });
    expect(call<ApplyResult>(CHANNELS.apply, mutation, {})).toEqual({ status: "error", message: `directory not allowed for: ${skillFile}` });
    expect(fs.existsSync(skillFile)).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("marks new files and masks secrets in the preview", async () => {
    await boot();
    const mutation: Mutation = {
      op: "upsertMcp",
      target: { kind: "cursor", filePath: `${h.home}/.cursor/mcp.json` },
      input: { name: "s", transport: "http", url: "https://x.test", headers: { Authorization: "Bearer topsecret1" } },
    };
    const preview = call<PreviewResult>(CHANNELS.preview, mutation);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.files[0]).toMatchObject({ creates: true, baseHash: null });
    const text = preview.files[0]?.diff.map((l) => l.text).join("\n") ?? "";
    expect(text).not.toContain("topsecret1");
    expect(text).toContain("••••••");
  });

  it("applies, restarts the watcher, backs up the original and undoes with the token", async () => {
    writeHome(".claude/CLAUDE.md", "# v1\n");
    await boot();
    const preview = call<PreviewResult>(CHANNELS.preview, WRITE());
    if (!preview.ok) throw new Error("preview failed");
    const hashes = { [claudeMd()]: preview.files[0]?.baseHash ?? null };
    const applied = call<ApplyResult>(CHANNELS.apply, WRITE(), hashes);
    expect(applied).toEqual({ status: "ok", undoToken: 1 });
    expect(fs.readFileSync(claudeMd(), "utf8")).toBe("# v2\n");
    expect(h.watchers).toHaveLength(2);
    expect((h.watchers[0] as InstanceType<typeof h.MockWatcher>).closed).toBe(true);
    expect(call<unknown[]>(CHANNELS.listBackups)).toHaveLength(1);

    expect(call<ApplyResult>(CHANNELS.undoLastApply, 99)).toEqual({
      status: "error",
      message: "Only the most recent save can be undone. Use Backups to restore older versions.",
    });
    expect(call<ApplyResult>(CHANNELS.undoLastApply, 1)).toEqual({ status: "ok" });
    expect(fs.readFileSync(claudeMd(), "utf8")).toBe("# v1\n");
    expect(h.watchers).toHaveLength(3);
    expect(call<ApplyResult>(CHANNELS.undoLastApply, 1).status).toBe("error");
  });

  it("undo removes a file the apply created, and reports a conflict if it changed since", async () => {
    await boot();
    const created = path.join(h.home, ".claude", "commands", "new.md");
    const mutation: Mutation = { op: "upsertMarkdown", kind: "command", dir: path.dirname(created), name: "new", frontmatter: {}, body: "hi\n" };
    const first = call<ApplyResult>(CHANNELS.apply, mutation, { [created]: null });
    expect(first).toEqual({ status: "ok", undoToken: 1 });
    expect(fs.existsSync(created)).toBe(true);
    expect(call<ApplyResult>(CHANNELS.undoLastApply, 1)).toEqual({ status: "ok" });
    expect(fs.existsSync(created)).toBe(false);

    const second = call<ApplyResult>(CHANNELS.apply, mutation, { [created]: null });
    expect(second).toEqual({ status: "ok", undoToken: 2 });
    fs.writeFileSync(created, "edited elsewhere");
    expect(call<ApplyResult>(CHANNELS.undoLastApply, 2)).toEqual({ status: "conflict", path: created });
  });

  it("refuses to undo into a project that has been removed since the save", async () => {
    const dir = path.join(h.home, "src", "demo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# demo");
    await boot();
    h.openDialog = async () => ({ canceled: false, filePaths: [dir] });
    await call<Promise<unknown>>(CHANNELS.addProject);
    const target = path.join(dir, "AGENTS.md");
    const mutation: Mutation = { op: "writeRaw", filePath: target, format: "markdown", newText: "# changed\n" };
    expect(call<ApplyResult>(CHANNELS.apply, mutation, {})).toEqual({ status: "ok", undoToken: 1 });
    call<ScanResultPayload>(CHANNELS.removeProject, dir);
    expect(call<ApplyResult>(CHANNELS.undoLastApply, 1)).toEqual({ status: "error", message: `path not allowed: ${target}` });
    expect(fs.readFileSync(target, "utf8")).toBe("# changed\n");
  });

  it("reports apply conflicts and errors without touching the file", async () => {
    writeHome(".claude/CLAUDE.md", "# v1\n");
    await boot();
    expect(call<ApplyResult>(CHANNELS.apply, WRITE(), { [claudeMd()]: "stale" })).toEqual({ status: "conflict", path: claudeMd() });
    expect(fs.readFileSync(claudeMd(), "utf8")).toBe("# v1\n");
    expect(h.watchers).toHaveLength(1);
    expect(call<ApplyResult>(CHANNELS.apply, { ...WRITE(), filePath: `${h.home}/.env` }, {})).toEqual({
      status: "error",
      message: `path not allowed: ${h.home}/.env`,
    });
  });
});

describe("projects", () => {
  it("adds a picked folder once, persists it and rescans; removal drops it again", async () => {
    const dir = path.join(h.home, "src", "demo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# demo");
    await boot();
    h.openDialog = async () => ({ canceled: false, filePaths: [dir] });
    const added = await call<Promise<ScanResultPayload | null>>(CHANNELS.addProject);
    expect(added?.projects).toEqual([{ path: dir, sources: ["manual"] }]);
    await call<Promise<ScanResultPayload | null>>(CHANNELS.addProject);
    expect(JSON.parse(fs.readFileSync(path.join(h.userData, "app-config.json"), "utf8")).projects).toEqual([dir]);
    expect(h.watchers).toHaveLength(3);

    const removed = call<ScanResultPayload>(CHANNELS.removeProject, dir);
    expect(removed.projects).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(h.userData, "app-config.json"), "utf8")).projects).toEqual([]);
  });

  it("returns null when the picker is cancelled or yields no path", async () => {
    await boot();
    expect(await call<Promise<unknown>>(CHANNELS.addProject)).toBeNull();
    h.openDialog = async () => ({ canceled: false, filePaths: [] });
    expect(await call<Promise<unknown>>(CHANNELS.addProject)).toBeNull();
  });
});

describe("backups", () => {
  async function applyOnce(): Promise<string> {
    writeHome(".claude/CLAUDE.md", "# v1\n");
    await boot();
    const preview = call<PreviewResult>(CHANNELS.preview, WRITE());
    if (!preview.ok) throw new Error("preview failed");
    call<ApplyResult>(CHANNELS.apply, WRITE(), { [claudeMd()]: preview.files[0]?.baseHash ?? null });
    const backups = call<{ id: string }[]>(CHANNELS.listBackups);
    return (backups[0] as { id: string }).id;
  }

  it("previews and applies a restore, guarded by the current hash", async () => {
    const id = await applyOnce();
    const preview = call<PreviewResult>(CHANNELS.previewRestore, id);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.files[0]).toMatchObject({ path: claudeMd(), creates: false, deletes: false });
    expect(preview.files[0]?.diff.map((l) => `${l.type}:${l.text}`)).toEqual(["del:# v2", "add:# v1"]);

    expect(call<ApplyResult>(CHANNELS.applyRestore, id, "stale")).toEqual({ status: "conflict", path: claudeMd() });
    expect(call<ApplyResult>(CHANNELS.applyRestore, id, preview.files[0]?.baseHash ?? null)).toEqual({ status: "ok", undoToken: 2 });
    expect(fs.readFileSync(claudeMd(), "utf8")).toBe("# v1\n");
    // exactly one new backup (of "# v2") — the restore must not snapshot the file twice
    expect(call<unknown[]>(CHANNELS.listBackups)).toHaveLength(2);
    expect(call<ApplyResult>(CHANNELS.undoLastApply, 2)).toEqual({ status: "ok" });
    expect(fs.readFileSync(claudeMd(), "utf8")).toBe("# v2\n");
  });

  it("restores into a file that has since been deleted", async () => {
    const id = await applyOnce();
    fs.rmSync(claudeMd());
    const preview = call<PreviewResult>(CHANNELS.previewRestore, id);
    expect(preview.ok && preview.files[0]?.creates).toBe(true);
    expect(call<ApplyResult>(CHANNELS.applyRestore, id, null)).toEqual({ status: "ok", undoToken: 2 });
    expect(fs.readFileSync(claudeMd(), "utf8")).toBe("# v1\n");
  });

  it("rejects malformed or out-of-scope backup ids", async () => {
    await boot();
    expect(call<PreviewResult>(CHANNELS.previewRestore, "%2Fetc%2Fpasswd/stamp")).toEqual({ ok: false, error: "path not allowed: /etc/passwd" });
    expect(call<ApplyResult>(CHANNELS.applyRestore, "%2Fetc%2Fpasswd/stamp", null)).toEqual({ status: "error", message: "path not allowed: /etc/passwd" });
    const encoded = encodeURIComponent(claudeMd());
    expect(call<PreviewResult>(CHANNELS.previewRestore, `${encoded}/`)).toEqual({ ok: false, error: "invalid backup id" });
    expect(call<ApplyResult>(CHANNELS.applyRestore, `${encoded}/missing-stamp`, null).status).toBe("error");
  });
});

describe("reveal / mcp test / update check", () => {
  it("reveals allowed paths only", async () => {
    await boot();
    call(CHANNELS.reveal, claudeMd());
    expect(h.shellShow).toEqual([claudeMd()]);
    expect(() => call(CHANNELS.reveal, "/etc/hosts")).toThrow("path not allowed: /etc/hosts");
  });

  it("probes stdio and http servers with the resolved timeout", async () => {
    await boot();
    const stdioArgs: unknown[][] = [];
    const httpArgs: unknown[][] = [];
    h.probeStdio = async (...args) => {
      stdioArgs.push(args);
      return { ok: true, phase: "protocol", detail: "s", elapsedMs: 1 };
    };
    h.probeHttp = async (...args) => {
      httpArgs.push(args);
      return { ok: true, phase: "protocol", detail: "h", elapsedMs: 1 };
    };
    await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "a", transport: "stdio", command: "npx", args: ["x"], env: { TOKEN: "abcd1234" } });
    expect(stdioArgs[0]).toEqual(["npx", ["x"], { TOKEN: "abcd1234" }, 10_000, ["abcd1234"]]);
    await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "a", transport: "stdio", command: "npx", startupTimeoutSec: 3 });
    expect(stdioArgs[1]).toEqual(["npx", [], {}, 3000, []]);
    await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "a", transport: "stdio", command: "npx", startupTimeoutSec: 3 }, 7);
    expect(stdioArgs[2]?.[3]).toBe(7000);
    await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "a", transport: "http", url: "https://x.test", headers: { A: "b" } });
    expect(httpArgs[0]).toEqual(["https://x.test", { A: "b" }, 10_000]);
    await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "a", transport: "sse", url: "https://y.test" });
    expect(httpArgs[1]).toEqual(["https://y.test", {}, 10_000]);
  });

  it("rejects incomplete inputs and concurrent tests", async () => {
    await boot();
    expect(await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "a", transport: "stdio", command: " " })).toEqual({
      ok: false,
      phase: "spawn",
      detail: "command is required",
      elapsedMs: 0,
    });
    expect(await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "a", transport: "http" })).toEqual({
      ok: false,
      phase: "http",
      detail: "url is required",
      elapsedMs: 0,
    });
    let finish: (v: unknown) => void = () => {};
    h.probeHttp = () => new Promise((resolve) => (finish = resolve));
    const first = call<Promise<unknown>>(CHANNELS.mcpTest, { name: "a", transport: "http", url: "https://x.test" });
    expect(await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "b", transport: "http", url: "https://x.test" })).toEqual({
      ok: false,
      phase: "spawn",
      detail: "another test is already running",
      elapsedMs: 0,
    });
    finish({ ok: true, phase: "protocol", detail: "late", elapsedMs: 5 });
    expect(await first).toMatchObject({ detail: "late" });
    h.probeHttp = async () => ({ ok: true, phase: "protocol", detail: "again", elapsedMs: 1 });
    expect(await call<Promise<unknown>>(CHANNELS.mcpTest, { name: "c", transport: "http", url: "https://x.test" })).toMatchObject({ detail: "again" });
  });

  it("compares the latest GitHub release with the running version", async () => {
    await boot();
    const responses: { ok: boolean; status: number; body: unknown }[] = [
      { ok: true, status: 200, body: { tag_name: "v9.9.9" } },
      { ok: true, status: 200, body: { tag_name: "0.1.0" } },
      { ok: false, status: 503, body: {} },
      { ok: true, status: 200, body: { tag_name: 42 } },
    ];
    const fetchMock = vi.fn(async (_url: string, _init?: unknown) => {
      const next = responses.shift() as { ok: boolean; status: number; body: unknown };
      return { ok: next.ok, status: next.status, json: async () => next.body };
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await call<Promise<UpdateCheckResult>>(CHANNELS.checkUpdate)).toEqual({ status: "update-available", current: "0.1.0", latest: "9.9.9", url: RELEASES });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/tktk7l9/agent-cockpit/releases/latest");
    expect(await call<Promise<UpdateCheckResult>>(CHANNELS.checkUpdate)).toEqual({ status: "up-to-date", current: "0.1.0" });
    expect(await call<Promise<UpdateCheckResult>>(CHANNELS.checkUpdate)).toEqual({ status: "error", message: "GitHub API returned 503" });
    expect(await call<Promise<UpdateCheckResult>>(CHANNELS.checkUpdate)).toEqual({ status: "error", message: "Could not parse release version" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await call<Promise<UpdateCheckResult>>(CHANNELS.checkUpdate)).toEqual({ status: "error", message: "offline" });
    vi.stubGlobal("fetch", async () => {
      throw "weird";
    });
    expect(await call<Promise<UpdateCheckResult>>(CHANNELS.checkUpdate)).toEqual({ status: "error", message: "weird" });
  });

  it("always opens the fixed releases page", async () => {
    await boot();
    call(CHANNELS.openReleases, "https://evil.test");
    expect(h.shellOpen).toEqual([RELEASES]);
  });
});
