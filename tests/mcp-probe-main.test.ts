// Real child-process tests for the main-process MCP probe. Not part of the
// src/lib coverage gate (vitest.config only gates src/lib/**) — these use
// the actual node binary as the "server" so they run unmodified on CI.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeHttp, probeStdio } from "../src/main/mcp-probe";

const NODE = process.execPath;

const ECHO_SERVER_SCRIPT = `
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  const nl = buf.indexOf("\\n");
  if (nl === -1) return;
  const msg = JSON.parse(buf.slice(0, nl));
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "test-server", version: "9.9.9" } } }) + "\\n");
});
`;

const SILENT_SCRIPT = `setTimeout(() => {}, 100000);`;

/** A silent server that also ignores SIGTERM, and writes its pid where the test can read it. */
const stubbornScript = (pidFile: string): string => `
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.on("SIGTERM", () => {});
setTimeout(() => {}, 100000);
`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("probeStdio", () => {
  it("succeeds against a real node process that answers initialize", async () => {
    const result = await probeStdio(NODE, ["-e", ECHO_SERVER_SCRIPT], {}, 5000);
    expect(result.ok).toBe(true);
    expect(result.phase).toBe("protocol");
    expect(result.serverName).toBe("test-server");
    expect(result.serverVersion).toBe("9.9.9");
  });

  it("times out and kills the process when nothing responds", async () => {
    const result = await probeStdio(NODE, ["-e", SILENT_SCRIPT], {}, 300);
    expect(result.ok).toBe(false);
    expect(result.phase).toBe("timeout");
  }, 6000);

  it("SIGKILLs a server that ignores SIGTERM once the grace period has passed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cockpit-probe-"));
    const pidFile = join(dir, "pid");
    try {
      // Long enough for node to start and write the pid before the probe gives up.
      const result = await probeStdio(NODE, ["-e", stubbornScript(pidFile)], {}, 1500);
      expect(result.phase).toBe("timeout");
      const pid = Number(readFileSync(pidFile, "utf8"));
      await sleep(500);
      expect(isAlive(pid)).toBe(true); // SIGTERM was ignored and the grace period is still running
      await sleep(2500);
      expect(isAlive(pid)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);

  it("reports a spawn failure for a nonexistent command", async () => {
    const result = await probeStdio("definitely-not-a-real-command-xyz123", [], {}, 2000);
    expect(result.ok).toBe(false);
    expect(result.phase).toBe("spawn");
    expect(result.detail).toContain("definitely-not-a-real-command-xyz123");
  });

  it("rejects an empty command without spawning", async () => {
    const result = await probeStdio("", [], {}, 1000);
    expect(result).toMatchObject({ ok: false, phase: "spawn" });
  });

  it("reports a non-protocol exit (process exits before answering)", async () => {
    const result = await probeStdio(NODE, ["-e", "process.exit(1)"], {}, 2000);
    expect(result.ok).toBe(false);
    expect(result.phase).toBe("exit");
    expect(result.detail).toContain("code 1");
  });
});

/** Starts a local HTTP server on a free port; the caller closes it. */
async function serve(handler: RequestListener): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/mcp` };
}

async function withServer(handler: RequestListener, body: (url: string) => Promise<void>): Promise<void> {
  const { server, url } = await serve(handler);
  try {
    await body(url);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("probeHttp", () => {
  it("reads the server name from an initialize answer", async () => {
    await withServer(
      (_req, res) => res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "remote", version: "1.2" } } })),
      async (url) => {
        const result = await probeHttp(url, {}, 2000);
        expect(result).toMatchObject({ ok: true, phase: "http", detail: "remote 1.2", serverName: "remote", serverVersion: "1.2" });
      },
    );
  });

  it("reports a non-2xx status", async () => {
    await withServer(
      (_req, res) => {
        res.statusCode = 401;
        res.end();
      },
      async (url) => {
        const result = await probeHttp(url, {}, 2000);
        expect(result).toMatchObject({ ok: false, phase: "http" });
        expect(result.detail).toMatch(/^HTTP 401/);
      },
    );
  });

  it("treats a 2xx without an initialize answer as reachable", async () => {
    await withServer(
      (_req, res) => res.end("hello"),
      async (url) => {
        const result = await probeHttp(url, {}, 2000);
        expect(result).toMatchObject({ ok: true, phase: "http", detail: "HTTP 200 (no parseable initialize response)" });
      },
    );
  });

  it("times out and cancels the request when the server never answers", async () => {
    let closed: () => void = () => {};
    const requestClosed = new Promise<void>((resolve) => (closed = resolve));
    await withServer(
      (req) => req.on("close", closed),
      async (url) => {
        const result = await probeHttp(url, {}, 300);
        expect(result).toMatchObject({ ok: false, phase: "timeout", detail: "no response within 300ms" });
        await requestClosed; // the abort reached the server; the test times out otherwise
      },
    );
  });

  it("reports failure for a connection that cannot be established", async () => {
    const result = await probeHttp("http://127.0.0.1:1/does-not-exist", {}, 2000);
    expect(result.ok).toBe(false);
    expect(["http", "timeout"]).toContain(result.phase);
  });
});
