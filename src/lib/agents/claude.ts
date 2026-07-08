// Readers for Claude Code configuration files.

import { parseJsonText } from "../json/jsonc-edit";
import { asRecord } from "./mcp-common";

export interface ClaudeProjectConfig {
  mcpServers: Record<string, Record<string, unknown>>;
  enabledMcpjsonServers: string[];
  disabledMcpjsonServers: string[];
}

export interface ClaudeGlobal {
  mcpServers: Record<string, Record<string, unknown>>;
  projects: Record<string, ClaudeProjectConfig>;
}

function mcpMap(value: unknown): Record<string, Record<string, unknown>> {
  const rec = asRecord(value);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(rec ?? {})) {
    const server = asRecord(raw);
    if (server) out[name] = server;
  }
  return out;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

export function parseClaudeGlobal(text: string | null): ClaudeGlobal {
  const root = asRecord(parseJsonText(text)) ?? {};
  const projects: Record<string, ClaudeProjectConfig> = {};
  for (const [path, cfg] of Object.entries(asRecord(root["projects"]) ?? {})) {
    const rec = asRecord(cfg) ?? {};
    projects[path] = {
      mcpServers: mcpMap(rec["mcpServers"]),
      enabledMcpjsonServers: stringList(rec["enabledMcpjsonServers"]),
      disabledMcpjsonServers: stringList(rec["disabledMcpjsonServers"]),
    };
  }
  return { mcpServers: mcpMap(root["mcpServers"]), projects };
}

export function parseMcpJsonFile(text: string | null): Record<string, Record<string, unknown>> {
  const root = asRecord(parseJsonText(text)) ?? {};
  return mcpMap(root["mcpServers"]);
}

/** Known keys surfaced in the settings quick-form (dotted paths). */
export function claudeSettingsKnown(text: string | null): Record<string, unknown> {
  const root = asRecord(parseJsonText(text)) ?? {};
  const known: Record<string, unknown> = {};
  if (root["model"] !== undefined) known["model"] = root["model"];
  if (root["effortLevel"] !== undefined) known["effortLevel"] = root["effortLevel"];
  const permissions = asRecord(root["permissions"]);
  if (permissions && permissions["defaultMode"] !== undefined) known["permissions.defaultMode"] = permissions["defaultMode"];
  return known;
}

export interface ClaudePermissions {
  defaultMode?: string;
  allow: string[];
  deny: string[];
  present: boolean;
}

/** Reads the permissions block for the dedicated Permissions editor (settings.json / settings.local.json). */
export function claudePermissions(text: string | null): ClaudePermissions {
  const root = asRecord(parseJsonText(text)) ?? {};
  const permissions = asRecord(root["permissions"]);
  if (!permissions) return { defaultMode: undefined, allow: [], deny: [], present: false };
  return {
    defaultMode: typeof permissions["defaultMode"] === "string" ? permissions["defaultMode"] : undefined,
    allow: stringList(permissions["allow"]),
    deny: stringList(permissions["deny"]),
    present: true,
  };
}

export function claudeEnabledPlugins(text: string | null): Record<string, boolean> {
  const root = asRecord(parseJsonText(text)) ?? {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(asRecord(root["enabledPlugins"]) ?? {})) {
    out[key] = value === true;
  }
  return out;
}

export interface InstalledPluginInfo {
  version?: string;
  installPath?: string;
}

export function parseInstalledPlugins(text: string | null): Record<string, InstalledPluginInfo> {
  const root = asRecord(parseJsonText(text)) ?? {};
  const out: Record<string, InstalledPluginInfo> = {};
  for (const [key, value] of Object.entries(asRecord(root["plugins"]) ?? {})) {
    const first = Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
    out[key] = {
      version: typeof first?.["version"] === "string" ? first["version"] : undefined,
      installPath: typeof first?.["installPath"] === "string" ? first["installPath"] : undefined,
    };
  }
  return out;
}
