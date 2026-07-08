import { describe, expect, it } from "vitest";
import { initializeRequestJson, parseInitializeResponse } from "../src/lib/mcp-probe";

describe("initializeRequestJson", () => {
  it("builds a newline-terminated single-line JSON-RPC initialize request", () => {
    const text = initializeRequestJson();
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n")).toHaveLength(2); // one JSON line + trailing empty
    const parsed = JSON.parse(text.trimEnd());
    expect(parsed).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agent-cockpit", version: "0.1.0" },
      },
    });
  });
});

describe("parseInitializeResponse", () => {
  it("returns null when no matching response line is present yet", () => {
    expect(parseInitializeResponse([])).toBeNull();
    expect(parseInitializeResponse(["", "  "])).toBeNull();
  });

  it("skips non-JSON lines", () => {
    expect(parseInitializeResponse(["not json at all", '{"id":1,"result":{}}'])).toEqual({
      ok: true,
      detail: "initialize OK",
    });
  });

  it("skips JSON lines that are not objects", () => {
    expect(parseInitializeResponse(["42", "[1,2,3]", '"a string"', '{"id":1,"result":{}}'])).toEqual({
      ok: true,
      detail: "initialize OK",
    });
  });

  it("skips responses with a mismatched or missing id", () => {
    expect(parseInitializeResponse(['{"id":2,"result":{}}', '{"result":{}}'])).toBeNull();
  });

  it("keeps scanning when id:1 matches but has neither error nor result yet", () => {
    expect(parseInitializeResponse(['{"id":1}', '{"id":1,"result":{}}'])).toEqual({
      ok: true,
      detail: "initialize OK",
    });
    expect(parseInitializeResponse(['{"id":1}'])).toBeNull();
  });

  it("reports failure with the server's error message", () => {
    expect(parseInitializeResponse(['{"id":1,"error":{"message":"bad request"}}'])).toEqual({
      ok: false,
      detail: "bad request",
    });
  });

  it("falls back to a generic message when the error has no message field", () => {
    expect(parseInitializeResponse(['{"id":1,"error":{}}'])).toEqual({
      ok: false,
      detail: "server returned an error",
    });
  });

  it("reports success with serverInfo name and version when present", () => {
    expect(
      parseInitializeResponse(['{"id":1,"result":{"serverInfo":{"name":"keyway","version":"1.2.3"}}}']),
    ).toEqual({ ok: true, detail: "keyway 1.2.3", serverName: "keyway", serverVersion: "1.2.3" });
  });

  it("reports success with name only when version is absent", () => {
    expect(parseInitializeResponse(['{"id":1,"result":{"serverInfo":{"name":"keyway"}}}'])).toEqual({
      ok: true,
      detail: "keyway",
      serverName: "keyway",
      serverVersion: undefined,
    });
  });

  it("reports a generic success when result has no serverInfo at all", () => {
    expect(parseInitializeResponse(['{"id":1,"result":{}}'])).toEqual({ ok: true, detail: "initialize OK" });
  });

  it("ignores malformed serverInfo field types", () => {
    expect(parseInitializeResponse(['{"id":1,"result":{"serverInfo":{"name":5,"version":6}}}'])).toEqual({
      ok: true,
      detail: "initialize OK",
      serverName: undefined,
      serverVersion: undefined,
    });
  });
});
