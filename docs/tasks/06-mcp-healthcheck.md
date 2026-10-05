# 06. MCP server health check (Test connection)

## Background / Goal

An MCP server definition can be saved, but whether it actually starts and responds is a separate matter. Add a "Test" button to the editor: for stdio, spawn a child process and do a JSON-RPC `initialize` handshake; for http/sse, check the response with an HTTP POST.

**Important security decision**: this is the app's first "child process execution". It only runs **a command the user has saved or already entered in the form** (it just runs the user's own configuration, so there is no privilege escalation), but the following MUST be observed strictly.

## Security requirements (invariants)

1. Always execute with `spawn(command, args)` (**shell: false**). Shell string concatenation and `exec` are forbidden
2. A timeout is mandatory (default 10 seconds, or codex's `startupTimeoutSec` if present). On timeout: SIGTERM → SIGKILL after 2 seconds
3. Read the child's stdout/stderr only as much as needed to judge the handshake, and **discard anything beyond the first 4KB** (memory protection against a runaway server)
4. Return only a result object to the renderer. If stderr text is returned, mask it first with `maskValues(text, list of env values)`
5. Pass env as "process environment variables + the form's env" merged (same behavior as Claude Code itself)
6. Only one test may run at a time (guard against rapid clicks: disable the button while running)

## Spec

- Add a `Test` button to the McpView editor (to the left of Save…). It tests with the **current form values** (it can be tried before saving)
- Result display (banner in the editor):
  - Success: `✓ initialize OK — <serverInfo.name> <serverInfo.version>` (when obtainable from the response) + elapsed ms
  - Failure: the failing phase (spawn failure / timeout / protocol error / non-zero exit) + short detail
- Protocol (stdio): MCP stdio transport = newline-delimited JSON-RPC.
  1. After startup, send this on stdin as one line: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"agent-cockpit","version":"0.1.0"}}}` + `\n`
  2. Line-buffer stdout and parse the JSON line containing `"id":1`. If it has `result`, success; if `error`, failure (show the message)
  3. After the verdict, it is fine to terminate the process **without sending** `{"jsonrpc":"2.0","method":"notifications/initialized"}` (this is for testing only)
- Protocol (http/sse): `fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...form headers }, body: initialize (same as above) })`.
  - 2xx counts as success (if the body's JSON-RPC result can be read, also show serverInfo). For an SSE response (`text/event-stream`), read only the first event and cut off. 4xx/5xx is a failure + show the status
  - **Note**: use the main process's fetch (the renderer cannot make external connections because of CSP). Use `AbortSignal.timeout(ms)` for the timeout

## Implementation steps

### 1. lib: pure protocol part (new `src/lib/mcp-probe.ts`)

Child processes and fetch are main's job. lib holds only message generation and response parsing (= 100% testable):

```ts
export function initializeRequestJson(): string;            // the JSON above + "\n"
export interface ProbeResult { ok: boolean; phase: "spawn"|"timeout"|"protocol"|"exit"|"http"; detail: string; serverName?: string; serverVersion?: string; elapsedMs: number }
/** Find the id:1 response among the accumulated stdout lines and judge it. Return null if not found */
export function parseInitializeResponse(lines: string[]): { ok: boolean; detail: string; serverName?: string; serverVersion?: string } | null;
```

Branches of `parseInitializeResponse`: skip non-JSON lines / skip id mismatch / has error / has result.serverInfo / has result but no serverInfo.

### 2. main: execution part (new `src/main/mcp-probe.ts`)

```ts
export async function probeStdio(command: string, args: string[], env: Record<string,string>, timeoutMs: number): Promise<ProbeResult>;
export async function probeHttp(url: string, headers: Record<string,string>, timeoutMs: number): Promise<ProbeResult>;
```

- `spawn(command, args, { env: { ...process.env, ...env }, stdio: ["pipe","pipe","pipe"] })`
- `error` event → phase "spawn" (for ENOENT, make the detail clear by including the command name)
- stdout `data` → split into lines with a 4KB cap → `parseInitializeResponse` → once decided, kill and resolve
- exit (before a verdict) → phase "exit" (code and the first 300 characters of masked stderr)
- **Validating command**: an empty string fails immediately. Do not apply a path allowlist (commands on PATH such as npx are legitimate) — but reject a `command` that contains a newline

### 3. IPC + UI

- `CHANNELS.mcpTest = "cockpit:mcp-test"` / `CockpitApi.mcpTest(input: McpInput, timeoutSec?: number): Promise<ProbeResult>` (add the three-point set following 00-conventions §3)
- main handler: `input.transport === "stdio" ? probeStdio(...) : probeHttp(...)`. Use `mcpSecretValues(input.env, input.headers)` for masking
- McpEditor: a `Test` button + result banner (`.banner`; for success, add a custom `.banner-ok` to styles.css based on `--ok`). Show `Testing…` while running

## Tests

- `tests/mcp-probe.test.ts` (lib part only, all branches): the shape of initializeRequestJson / the 5 branches of parseInitializeResponse
- Real-process test of the main execution part (recommended, outside the gate): `tests/mcp-probe-main.test.ts` with genuine spawn tests that use `node -e 'script'` as the command:
  - Success case: a one-liner that receives initialize via `process.stdin.on("data", ...)` and returns a result
  - Timeout case: a one-liner that returns nothing + timeoutMs 500
  - Spawn failure case: a nonexistent command name
  - Use only node one-liners that also work on CI (ubuntu)

## Verification (real app)

1. Full gate suite green
2. `npx electron .` → Test on keyway (stdio) → success banner (serverInfo shown)
3. Test on mdn (http) → success
4. In a new form, Test with `command: no-such-cmd` → the spawn failure appears immediately
5. Test with the equivalent of `command: sleep, args: [30]` → timeout shown after 10 seconds, and no process left behind (`pgrep sleep`)

## Completion criteria

- [ ] All 5 verification points pass
- [ ] lib 100%×4 maintained
- [ ] The four points shell: false / timeout / 4KB cap / stderr masking can be confirmed in code review
- [ ] The portal (my-apps-portal projects.ts) note "zero network communication at runtime" does not contradict this if the test is user-initiated, but separately propose a PR updating `securityScores.notes` to "communication happens only when the user runs Test" (this is outside this repository, so do not implement it)
