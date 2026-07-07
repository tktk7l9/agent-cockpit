// Normalization between on-disk MCP server records and the domain model.

import type { McpTransport } from "../model/types";

export interface NormalizedMcp {
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  startupTimeoutSec?: number;
  extras: Record<string, unknown>;
}

export interface McpInput {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  startupTimeoutSec?: number;
  extras?: Record<string, unknown>;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = String(v);
  return out;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => String(v));
}

const KNOWN_KEYS = new Set(["type", "command", "args", "env", "url", "headers", "startup_timeout_sec"]);

export function normalizeMcp(raw: Record<string, unknown>): NormalizedMcp {
  const type = typeof raw["type"] === "string" ? raw["type"] : undefined;
  const url = typeof raw["url"] === "string" ? raw["url"] : undefined;
  let transport: McpTransport;
  if (type === "http" || type === "sse") transport = type;
  else if (type === "stdio") transport = "stdio";
  else transport = url !== undefined ? "http" : "stdio";
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(k)) extras[k] = v;
  }
  const timeout = raw["startup_timeout_sec"];
  return {
    transport,
    command: typeof raw["command"] === "string" ? raw["command"] : undefined,
    args: stringArray(raw["args"]),
    env: stringRecord(raw["env"]),
    url,
    headers: stringRecord(raw["headers"]),
    startupTimeoutSec: typeof timeout === "number" ? timeout : undefined,
    extras,
  };
}

/** Build the JSON record written to mcpServers maps (claude/cursor/.mcp.json). */
export function denormalizeMcpJson(input: McpInput): Record<string, unknown> {
  const out: Record<string, unknown> = { type: input.transport };
  if (input.transport === "stdio") {
    out["command"] = input.command;
    if (input.args && input.args.length > 0) out["args"] = input.args;
    if (input.env && Object.keys(input.env).length > 0) out["env"] = input.env;
  } else {
    out["url"] = input.url;
    if (input.headers && Object.keys(input.headers).length > 0) out["headers"] = input.headers;
  }
  for (const [k, v] of Object.entries(input.extras ?? {})) {
    if (!KNOWN_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** Secrets that must be masked in diffs: env + header values. */
export function mcpSecretValues(...sources: (Record<string, string> | undefined)[]): string[] {
  const out = new Set<string>();
  for (const rec of sources) {
    for (const v of Object.values(rec ?? {})) {
      if (v.length >= 4) out.add(v);
    }
  }
  return [...out];
}
