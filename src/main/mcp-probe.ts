// Executes the MCP "Test connection" health check: spawns the stdio server
// (or POSTs to the remote URL) and runs the initialize handshake from
// src/lib/mcp-probe.ts. This is the only place in the app that runs a child
// process or makes an outbound network request, and only in direct response
// to the user pressing Test.
//
// Written with Effect so that the three ways a probe ends (answer, failure,
// timeout) share one cleanup path: the child process (or the HTTP request's
// AbortController) is acquired with acquireRelease, and the timeout interrupts
// the probe, which releases it.
// The exported functions stay Promise-based for the IPC handlers.

import { spawn, type ChildProcess } from "node:child_process";
import { Data, Effect } from "effect";
import { initializeRequestJson, parseInitializeResponse, type ProbePhase, type ProbeResult } from "../lib/mcp-probe";
import { maskValues } from "../lib/redact";

const MAX_BUFFER = 4096;
const KILL_GRACE_MS = 2000;
const STDERR_DETAIL_CHARS = 300;

/** A probe that did not get an initialize answer. */
class ProbeFailure extends Data.TaggedError("ProbeFailure")<{
  readonly phase: Exclude<ProbePhase, "protocol">;
  readonly detail: string;
}> {}

type ProbeOutcome = Omit<ProbeResult, "elapsedMs">;

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * SIGTERM now, SIGKILL after the grace period if the server ignored it.
 *
 * Checks hasExited, not `child.killed`: `killed` turns true as soon as a signal
 * is *sent*, so testing it after SIGTERM never reaches SIGKILL, and a server
 * that ignores SIGTERM kept running after every Test press.
 */
function terminate(child: ChildProcess): void {
  if (hasExited(child)) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (!hasExited(child)) child.kill("SIGKILL");
  }, KILL_GRACE_MS);
  child.once("exit", () => clearTimeout(timer));
}

/** Waits for the first of: an initialize answer, a spawn error, or the process exiting. */
const awaitInitialize = (
  child: ChildProcess,
  command: string,
  secretValues: string[],
): Effect.Effect<ProbeOutcome, ProbeFailure> =>
  Effect.callback<ProbeOutcome, ProbeFailure>((resume) => {
    let stdoutBuf = "";
    let stderrBuf = "";

    child.on("error", (err) => {
      resume(Effect.fail(new ProbeFailure({ phase: "spawn", detail: `${command}: ${err.message}` })));
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBuf.length < MAX_BUFFER) stdoutBuf += chunk.toString("utf8").slice(0, MAX_BUFFER - stdoutBuf.length);
      const parsed = parseInitializeResponse(stdoutBuf.split("\n"));
      if (parsed) {
        resume(
          Effect.succeed({
            ok: parsed.ok,
            phase: "protocol",
            detail: parsed.detail,
            serverName: parsed.serverName,
            serverVersion: parsed.serverVersion,
          }),
        );
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < MAX_BUFFER) stderrBuf += chunk.toString("utf8").slice(0, MAX_BUFFER - stderrBuf.length);
    });

    child.on("exit", (code) => {
      const masked = maskValues(stderrBuf.slice(0, STDERR_DETAIL_CHARS), secretValues);
      resume(
        Effect.fail(
          new ProbeFailure({
            phase: "exit",
            detail: `process exited with code ${code ?? "null"}${masked ? `: ${masked}` : ""}`,
          }),
        ),
      );
    });

    // A server that exits before reading stdin makes this write fail with EPIPE.
    // The exit handler above reports that; unhandled, the stream error would
    // crash the main process.
    child.stdin?.on("error", () => {});
    child.stdin?.write(initializeRequestJson());
  });

const timeoutAfter = (timeoutMs: number) =>
  Effect.timeoutOrElse({
    duration: timeoutMs,
    orElse: () => Effect.fail(new ProbeFailure({ phase: "timeout", detail: `no response within ${timeoutMs}ms` })),
  });

/** Runs a probe and reports every ending, failures included, as a ProbeResult. */
function run(probe: Effect.Effect<ProbeOutcome, ProbeFailure>): Promise<ProbeResult> {
  const start = Date.now();
  return Effect.runPromise(
    probe.pipe(
      Effect.catchTag("ProbeFailure", ({ phase, detail }) => Effect.succeed<ProbeOutcome>({ ok: false, phase, detail })),
      Effect.map((outcome) => ({ ...outcome, elapsedMs: Date.now() - start })),
    ),
  );
}

export function probeStdio(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
  secretValues: string[] = [],
): Promise<ProbeResult> {
  return run(
    Effect.gen(function* () {
      if (command.trim() === "" || command.includes("\n")) {
        return yield* new ProbeFailure({ phase: "spawn", detail: "command must be a non-empty single line" });
      }
      const child = yield* Effect.acquireRelease(
        Effect.sync(() => spawn(command, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] })),
        (child) => Effect.sync(() => terminate(child)),
      );
      return yield* awaitInitialize(child, command, secretValues);
    }).pipe(Effect.scoped, timeoutAfter(timeoutMs)),
  );
}

export function probeHttp(url: string, headers: Record<string, string>, timeoutMs: number): Promise<ProbeResult> {
  const httpFailure = (err: unknown) => new ProbeFailure({ phase: "http", detail: String(err) });
  return run(
    Effect.gen(function* () {
      // One controller for the request and its body, aborted however the probe ends. The
      // per-call signal tryPromise offers is not enough: it is only aborted while fetch()
      // itself is pending, so a timeout during the body read (an SSE stream that never
      // sends the answer) would leave the connection open.
      const controller = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (c) => Effect.sync(() => c.abort()),
      );
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
            body: initializeRequestJson(),
            signal: controller.signal,
          }),
        catch: httpFailure,
      });
      if (!response.ok) {
        return yield* new ProbeFailure({ phase: "http", detail: `HTTP ${response.status} ${response.statusText}` });
      }
      const text = yield* Effect.tryPromise({ try: () => response.text(), catch: httpFailure });
      const parsed = parseInitializeResponse(text.split("\n"));
      if (!parsed) {
        return { ok: true, phase: "http", detail: `HTTP ${response.status} (no parseable initialize response)` } as const;
      }
      return {
        ok: parsed.ok,
        phase: "http",
        detail: parsed.detail,
        serverName: parsed.serverName,
        serverVersion: parsed.serverVersion,
      } as const;
    }).pipe(Effect.scoped, timeoutAfter(timeoutMs)),
  );
}
