// Pure protocol pieces for the MCP "Test connection" health check. Process
// spawning and HTTP fetch live in src/main/mcp-probe.ts — this file only
// builds the initialize request and parses the response lines.

export type ProbePhase = "spawn" | "timeout" | "protocol" | "exit" | "http";

export interface ProbeResult {
  ok: boolean;
  phase: ProbePhase;
  detail: string;
  serverName?: string;
  serverVersion?: string;
  elapsedMs: number;
}

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "agent-cockpit", version: "0.1.0" };

/** The single-line JSON-RPC `initialize` request, newline-terminated. */
export function initializeRequestJson(): string {
  return (
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    }) + "\n"
  );
}

export interface ParsedInitialize {
  ok: boolean;
  detail: string;
  serverName?: string;
  serverVersion?: string;
}

interface JsonRpcErrorShape {
  message?: unknown;
}

interface JsonRpcResultShape {
  serverInfo?: { name?: unknown; version?: unknown };
}

/** Scans buffered stdout/SSE lines for the id:1 response. null = not found yet. */
export function parseInitializeResponse(lines: string[]): ParsedInitialize | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const rec = parsed as Record<string, unknown>;
    if (rec["id"] !== 1) continue;

    if (rec["error"] !== undefined) {
      const err = rec["error"] as JsonRpcErrorShape;
      const message = typeof err.message === "string" ? err.message : "server returned an error";
      return { ok: false, detail: message };
    }

    if (rec["result"] !== undefined) {
      const result = rec["result"] as JsonRpcResultShape;
      const name = typeof result.serverInfo?.name === "string" ? result.serverInfo.name : undefined;
      const version = typeof result.serverInfo?.version === "string" ? result.serverInfo.version : undefined;
      return {
        ok: true,
        detail: name !== undefined ? `${name}${version ? ` ${version}` : ""}` : "initialize OK",
        serverName: name,
        serverVersion: version,
      };
    }
  }
  return null;
}
