// Executes the MCP "Test connection" health check: spawns the stdio server
// (or POSTs to the remote URL) and runs the initialize handshake from
// src/lib/mcp-probe.ts. This is the only place in the app that runs a child
// process or makes an outbound network request, and only in direct response
// to the user pressing Test.

import { spawn } from "node:child_process";
import { initializeRequestJson, parseInitializeResponse, type ProbeResult } from "../lib/mcp-probe";
import { maskValues } from "../lib/redact";

const MAX_BUFFER = 4096;
const KILL_GRACE_MS = 2000;
const STDERR_DETAIL_CHARS = 300;

function now(): number {
  return Date.now();
}

export function probeStdio(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
  secretValues: string[] = [],
): Promise<ProbeResult> {
  const start = now();
  return new Promise((resolve) => {
    if (command.trim() === "" || command.includes("\n")) {
      resolve({ ok: false, phase: "spawn", detail: "command must be a non-empty single line", elapsedMs: now() - start });
      return;
    }

    let settled = false;
    let stdoutBuf = "";
    let stderrBuf = "";
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });

    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
      if (!child.killed) {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, KILL_GRACE_MS);
      }
    };

    timeoutTimer = setTimeout(() => {
      finish({ ok: false, phase: "timeout", detail: `no response within ${timeoutMs}ms`, elapsedMs: now() - start });
    }, timeoutMs);

    child.on("error", (err) => {
      finish({ ok: false, phase: "spawn", detail: `${command}: ${err.message}`, elapsedMs: now() - start });
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBuf.length < MAX_BUFFER) stdoutBuf += chunk.toString("utf8").slice(0, MAX_BUFFER - stdoutBuf.length);
      const parsed = parseInitializeResponse(stdoutBuf.split("\n"));
      if (parsed) {
        finish({
          ok: parsed.ok,
          phase: "protocol",
          detail: parsed.detail,
          serverName: parsed.serverName,
          serverVersion: parsed.serverVersion,
          elapsedMs: now() - start,
        });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < MAX_BUFFER) stderrBuf += chunk.toString("utf8").slice(0, MAX_BUFFER - stderrBuf.length);
    });

    child.on("exit", (code) => {
      const masked = maskValues(stderrBuf.slice(0, STDERR_DETAIL_CHARS), secretValues);
      finish({
        ok: false,
        phase: "exit",
        detail: `process exited with code ${code ?? "null"}${masked ? `: ${masked}` : ""}`,
        elapsedMs: now() - start,
      });
    });

    child.stdin?.write(initializeRequestJson());
  });
}

export async function probeHttp(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ProbeResult> {
  const start = now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
      body: initializeRequestJson(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, phase: "http", detail: `HTTP ${response.status} ${response.statusText}`, elapsedMs: now() - start };
    }
    const text = await response.text();
    const parsed = parseInitializeResponse(text.split("\n"));
    if (!parsed) {
      return { ok: true, phase: "http", detail: `HTTP ${response.status} (no parseable initialize response)`, elapsedMs: now() - start };
    }
    return {
      ok: parsed.ok,
      phase: "http",
      detail: parsed.detail,
      serverName: parsed.serverName,
      serverVersion: parsed.serverVersion,
      elapsedMs: now() - start,
    };
  } catch (err) {
    const detail = err instanceof Error && err.name === "TimeoutError" ? `no response within ${timeoutMs}ms` : String(err);
    return { ok: false, phase: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "http", detail, elapsedMs: now() - start };
  }
}
