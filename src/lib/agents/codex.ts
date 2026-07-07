// Reader for ~/.codex/config.toml (values only — writes are surgical splices
// done by toml-edit.ts against the original text).

import { parse } from "smol-toml";
import { asRecord } from "./mcp-common";

export interface CodexConfig {
  mcpServers: Record<string, Record<string, unknown>>;
  plugins: Record<string, boolean>;
  projects: Record<string, { trustLevel?: string }>;
  known: Record<string, unknown>;
}

export function parseCodexConfig(text: string | null): CodexConfig {
  // smol-toml's parse always returns a plain table object
  const root: Record<string, unknown> = text === null || text.trim() === "" ? {} : parse(text);
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(asRecord(root["mcp_servers"]) ?? {})) {
    const server = asRecord(raw);
    if (server) mcpServers[name] = server;
  }
  const plugins: Record<string, boolean> = {};
  for (const [key, raw] of Object.entries(asRecord(root["plugins"]) ?? {})) {
    plugins[key] = asRecord(raw)?.["enabled"] === true;
  }
  const projects: Record<string, { trustLevel?: string }> = {};
  for (const [path, raw] of Object.entries(asRecord(root["projects"]) ?? {})) {
    const rec = asRecord(raw);
    projects[path] = {
      trustLevel: typeof rec?.["trust_level"] === "string" ? rec["trust_level"] : undefined,
    };
  }
  const known: Record<string, unknown> = {};
  if (root["model"] !== undefined) known["model"] = root["model"];
  if (root["model_reasoning_effort"] !== undefined) known["model_reasoning_effort"] = root["model_reasoning_effort"];
  return { mcpServers, plugins, projects, known };
}
