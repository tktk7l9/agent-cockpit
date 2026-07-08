// Typed IPC contract shared by main, preload and renderer.

import type { DiffLine } from "../lib/diff";
import type { McpInput } from "../lib/agents/mcp-common";
import type { ProbeResult } from "../lib/mcp-probe";
import type { Inventory } from "../lib/model/types";
import type { Mutation } from "../lib/mutations";

export interface ScanResultPayload extends Inventory {
  home: string;
}

export interface PreviewFile {
  path: string;
  /** sha256 of the file content at preview time; null = file absent. */
  baseHash: string | null;
  creates: boolean;
  deletes: boolean;
  diff: DiffLine[];
}

export type PreviewResult = { ok: true; files: PreviewFile[] } | { ok: false; error: string };

export type ApplyResult =
  | { status: "ok" }
  | { status: "conflict"; path: string }
  | { status: "error"; message: string };

export interface BackupInfo {
  id: string;
  sourcePath: string;
  /** ISO timestamp */
  timestamp: string;
  size: number;
}

export type BaseHashes = Record<string, string | null>;

export const CHANNELS = {
  scan: "cockpit:scan",
  preview: "cockpit:preview",
  apply: "cockpit:apply",
  addProject: "cockpit:add-project",
  removeProject: "cockpit:remove-project",
  listBackups: "cockpit:list-backups",
  previewRestore: "cockpit:preview-restore",
  applyRestore: "cockpit:apply-restore",
  reveal: "cockpit:reveal",
  changed: "cockpit:changed",
  mcpTest: "cockpit:mcp-test",
} as const;

export interface CockpitApi {
  scan(): Promise<ScanResultPayload>;
  preview(mutation: Mutation): Promise<PreviewResult>;
  apply(mutation: Mutation, baseHashes: BaseHashes): Promise<ApplyResult>;
  /** Opens a folder picker; returns the new scan or null when cancelled. */
  addProject(): Promise<ScanResultPayload | null>;
  removeProject(path: string): Promise<ScanResultPayload>;
  listBackups(): Promise<BackupInfo[]>;
  previewRestore(id: string): Promise<PreviewResult>;
  applyRestore(id: string, baseHash: string | null): Promise<ApplyResult>;
  reveal(path: string): Promise<void>;
  /** Runs the initialize handshake against the given (unsaved) MCP server form values. */
  mcpTest(input: McpInput, timeoutSec?: number): Promise<ProbeResult>;
  /** Fires (debounced) when any watched config file changes on disk. */
  onChanged(callback: () => void): () => void;
}
