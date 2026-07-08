// Real child-process tests for the main-process MCP probe. Not part of the
// src/lib coverage gate (vitest.config only gates src/lib/**) — these use
// the actual node binary as the "server" so they run unmodified on CI.

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

describe("probeHttp", () => {
  it("reports failure for a connection that cannot be established", async () => {
    const result = await probeHttp("http://127.0.0.1:1/does-not-exist", {}, 2000);
    expect(result.ok).toBe(false);
    expect(["http", "timeout"]).toContain(result.phase);
  });
});
