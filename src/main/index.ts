import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import * as os from "node:os";
import * as path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { McpInput } from "../lib/agents/mcp-common";
import { mcpSecretValues } from "../lib/agents/mcp-common";
import { buildDiffLines, maskDiff } from "../lib/diff";
import type { ProbeResult } from "../lib/mcp-probe";
import type { FileEdit } from "../lib/model/types";
import { mutationReadPaths, planMutation, type Mutation } from "../lib/mutations";
import { watchPaths } from "../lib/paths";
import { CHANNELS, type ApplyResult, type BaseHashes, type PreviewFile, type PreviewResult } from "../shared/ipc";
import {
  applyFileEdits,
  decodeBackupId,
  hashOrNull,
  listBackups,
  readBackup,
  readTextIfExists,
  resolveAndCheck,
  writeBackup,
} from "./fs-gateway";
import { probeHttp, probeStdio } from "./mcp-probe";
import { runScan, resolveProjects } from "./scan";
import { loadAppConfig, saveAppConfig } from "./state";

const HOME = os.homedir();

let mainWindow: BrowserWindow | null = null;
let watcher: FSWatcher | null = null;
let changeTimer: NodeJS.Timeout | null = null;
let mcpTestInFlight = false;

const DEFAULT_MCP_TEST_TIMEOUT_SEC = 10;
const DARK_BG = "#101418";
const LIGHT_BG = "#f5f7fa";

function userData(): string {
  return app.getPath("userData");
}

function currentProjects(): string[] {
  return resolveProjects(HOME, loadAppConfig(userData()).projects);
}

function checkPath(filePath: string): string {
  return resolveAndCheck(HOME, currentProjects(), filePath);
}

function notifyChanged(): void {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    mainWindow?.webContents.send(CHANNELS.changed);
  }, 300);
}

function restartWatcher(): void {
  void watcher?.close();
  watcher = chokidar.watch(watchPaths(HOME, currentProjects()), {
    ignoreInitial: true,
    depth: 2,
    ignored: (p: string) => path.basename(p) === "auth.json" || path.basename(p).startsWith(".env"),
  });
  watcher.on("all", notifyChanged);
}

function planFresh(mutation: Mutation): { edits: FileEdit[]; baseHashes: BaseHashes } {
  const reads = new Map<string, string | null>();
  const snapshot = (p: string): string | null => {
    if (!reads.has(p)) reads.set(p, readTextIfExists(checkPath(p)));
    return reads.get(p) as string | null;
  };
  for (const p of mutationReadPaths(mutation)) snapshot(p);
  const edits = planMutation({ snapshot }, mutation);
  const baseHashes: BaseHashes = {};
  for (const edit of edits) {
    checkPath(edit.path);
    baseHashes[edit.path] = hashOrNull(readTextIfExists(edit.path));
  }
  return { edits, baseHashes };
}

function toPreview(edits: FileEdit[], baseHashes: BaseHashes): PreviewResult {
  const files: PreviewFile[] = edits.map((edit) => {
    const old = readTextIfExists(edit.path);
    return {
      path: edit.path,
      baseHash: baseHashes[edit.path] ?? null,
      creates: old === null && edit.newText !== null,
      deletes: edit.newText === null,
      diff: maskDiff(buildDiffLines(old, edit.newText), edit.secretValues ?? []),
    };
  });
  return { ok: true, files };
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.scan, () => runScan(HOME, loadAppConfig(userData()).projects));

  ipcMain.handle(CHANNELS.preview, (_e, mutation: Mutation): PreviewResult => {
    try {
      const { edits, baseHashes } = planFresh(mutation);
      return toPreview(edits, baseHashes);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.apply, (_e, mutation: Mutation, baseHashes: BaseHashes): ApplyResult => {
    try {
      const { edits } = planFresh(mutation);
      const outcome = applyFileEdits(userData(), edits, baseHashes);
      if (outcome.status === "conflict") return { status: "conflict", path: outcome.conflictPath ?? "" };
      restartWatcher();
      return { status: "ok" };
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.addProject, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    const dir = result.filePaths[0];
    if (result.canceled || !dir) return null;
    const config = loadAppConfig(userData());
    if (!config.projects.includes(dir)) {
      config.projects.push(dir);
      saveAppConfig(userData(), config);
    }
    restartWatcher();
    return runScan(HOME, config.projects);
  });

  ipcMain.handle(CHANNELS.removeProject, (_e, projectPath: string) => {
    const config = loadAppConfig(userData());
    config.projects = config.projects.filter((p) => p !== projectPath);
    saveAppConfig(userData(), config);
    restartWatcher();
    return runScan(HOME, config.projects);
  });

  ipcMain.handle(CHANNELS.listBackups, () => listBackups(userData()));

  ipcMain.handle(CHANNELS.previewRestore, (_e, id: string): PreviewResult => {
    try {
      const { sourcePath } = decodeBackupId(id);
      checkPath(sourcePath);
      const backupText = readBackup(userData(), id);
      const current = readTextIfExists(sourcePath);
      return {
        ok: true,
        files: [
          {
            path: sourcePath,
            baseHash: hashOrNull(current),
            creates: current === null,
            deletes: false,
            diff: buildDiffLines(current, backupText),
          },
        ],
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.applyRestore, (_e, id: string, baseHash: string | null): ApplyResult => {
    try {
      const { sourcePath } = decodeBackupId(id);
      checkPath(sourcePath);
      const backupText = readBackup(userData(), id);
      const current = readTextIfExists(sourcePath);
      if (hashOrNull(current) !== baseHash) return { status: "conflict", path: sourcePath };
      if (current !== null) writeBackup(userData(), sourcePath, current);
      applyFileEdits(userData(), [{ path: sourcePath, newText: backupText }], { [sourcePath]: baseHash });
      return { status: "ok" };
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.reveal, (_e, filePath: string) => {
    shell.showItemInFolder(checkPath(filePath));
  });

  ipcMain.handle(CHANNELS.mcpTest, async (_e, input: McpInput, timeoutSec?: number): Promise<ProbeResult> => {
    if (mcpTestInFlight) {
      return { ok: false, phase: "spawn", detail: "another test is already running", elapsedMs: 0 };
    }
    mcpTestInFlight = true;
    try {
      const timeoutMs = (timeoutSec ?? input.startupTimeoutSec ?? DEFAULT_MCP_TEST_TIMEOUT_SEC) * 1000;
      if (input.transport === "stdio") {
        if (!input.command || input.command.trim() === "") {
          return { ok: false, phase: "spawn", detail: "command is required", elapsedMs: 0 };
        }
        return await probeStdio(
          input.command,
          input.args ?? [],
          input.env ?? {},
          timeoutMs,
          mcpSecretValues(input.env, input.headers),
        );
      }
      if (!input.url || input.url.trim() === "") {
        return { ok: false, phase: "http", detail: "url is required", elapsedMs: 0 };
      }
      return await probeHttp(input.url, input.headers ?? {}, timeoutMs);
    } finally {
      mcpTestInFlight = false;
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Agent Cockpit",
    titleBarStyle: "hiddenInset",
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  nativeTheme.on("updated", () => {
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  restartWatcher();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
