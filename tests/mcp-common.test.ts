import { describe, expect, it } from "vitest";
import { asRecord, denormalizeMcpJson, mcpSecretValues, normalizeMcp } from "../src/lib/agents/mcp-common";

describe("asRecord", () => {
  it("accepts objects, rejects arrays/null/primitives", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toBeUndefined();
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord("x")).toBeUndefined();
  });
});

describe("normalizeMcp", () => {
  it("normalizes a stdio server", () => {
    const n = normalizeMcp({ type: "stdio", command: "npx", args: ["-y", 1], env: { A: "b", N: 2 }, custom: true });
    expect(n.transport).toBe("stdio");
    expect(n.command).toBe("npx");
    expect(n.args).toEqual(["-y", "1"]);
    expect(n.env).toEqual({ A: "b", N: "2" });
    expect(n.extras).toEqual({ custom: true });
  });

  it("infers http from url when type is missing", () => {
    expect(normalizeMcp({ url: "https://x" }).transport).toBe("http");
    expect(normalizeMcp({ command: "x" }).transport).toBe("stdio");
  });

  it("honors explicit http/sse types and headers", () => {
    const n = normalizeMcp({ type: "sse", url: "https://x", headers: { Authorization: "Bearer t" } });
    expect(n.transport).toBe("sse");
    expect(n.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("ignores malformed fields", () => {
    const n = normalizeMcp({ command: 5, args: "not-array", env: "nope", startup_timeout_sec: "soon" });
    expect(n.command).toBeUndefined();
    expect(n.args).toBeUndefined();
    expect(n.env).toBeUndefined();
    expect(n.startupTimeoutSec).toBeUndefined();
  });

  it("reads codex startup_timeout_sec", () => {
    expect(normalizeMcp({ command: "x", startup_timeout_sec: 30 }).startupTimeoutSec).toBe(30);
  });
});

describe("denormalizeMcpJson", () => {
  it("writes a minimal stdio record", () => {
    expect(denormalizeMcpJson({ name: "a", transport: "stdio", command: "npx", args: [], env: {} })).toEqual({
      type: "stdio",
      command: "npx",
    });
  });

  it("writes stdio with args and env", () => {
    expect(
      denormalizeMcpJson({ name: "a", transport: "stdio", command: "npx", args: ["-y"], env: { K: "v" } }),
    ).toEqual({ type: "stdio", command: "npx", args: ["-y"], env: { K: "v" } });
  });

  it("writes remote records with headers", () => {
    expect(denormalizeMcpJson({ name: "a", transport: "http", url: "https://x", headers: { A: "b" } })).toEqual({
      type: "http",
      url: "https://x",
      headers: { A: "b" },
    });
    expect(denormalizeMcpJson({ name: "a", transport: "sse", url: "https://x" })).toEqual({ type: "sse", url: "https://x" });
  });

  it("passes extras through but never overrides known keys", () => {
    const out = denormalizeMcpJson({
      name: "a",
      transport: "stdio",
      command: "npx",
      extras: { note: "hi", command: "evil" },
    });
    expect(out["note"]).toBe("hi");
    expect(out["command"]).toBe("npx");
  });
});

describe("mcpSecretValues", () => {
  it("collects unique env/header values, skipping short ones", () => {
    expect(mcpSecretValues({ A: "secret-1", B: "abc" }, { C: "secret-1", D: "other-secret" })).toEqual([
      "secret-1",
      "other-secret",
    ]);
    expect(mcpSecretValues(undefined, undefined)).toEqual([]);
  });
});
