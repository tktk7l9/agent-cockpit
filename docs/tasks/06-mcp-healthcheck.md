# 06. MCP サーバーのヘルスチェック（Test connection）

## 背景 / 目的

MCP サーバー定義は保存できても実際に起動・応答するかは別問題。エディタに「Test」ボタンを付け、stdio なら子プロセス起動 + JSON-RPC `initialize` ハンドシェイク、http/sse なら HTTP POST で応答確認する。

**セキュリティ上の重要判断**: これは本アプリ初の「子プロセス実行」。実行するのは **ユーザーが保存済み or フォームに入力済みのコマンド** のみ（ユーザー自身の設定を実行するだけで権限昇格はない）が、以下を厳守する。

## セキュリティ要件（不変条件）

1. 実行は必ず `spawn(command, args)`（**shell: false**）。シェル文字列連結・`exec` は禁止
2. タイムアウト必須（デフォルト 10 秒、codex の `startupTimeoutSec` があればそれ）。タイムアウト時は SIGTERM → 2秒後 SIGKILL
3. 子プロセスの stdout/stderr はハンドシェイク判定に必要な分だけ読み、**先頭 4KB を超えた分は破棄**（暴走サーバーのメモリ保護）
4. renderer には結果オブジェクトのみ返す。stderr 本文を返す場合は `maskValues(text, envの値一覧)` でマスクしてから
5. env は「プロセスの環境変数 + フォームの env」をマージして渡す（Claude Code 本体と同じ挙動）
6. 同時実行は 1 テストのみ（連打対策: 実行中はボタン無効化）

## 仕様

- McpView エディタに `Test` ボタン（Save… の左）。**フォームの現在値** でテストする（保存前でも試せる）
- 結果表示（エディタ内バナー）:
  - 成功: `✓ initialize OK — <serverInfo.name> <serverInfo.version>`（レスポンスから取得できた場合）+ 所要 ms
  - 失敗: 失敗フェーズ（spawn 失敗 / タイムアウト / プロトコルエラー / 非ゼロ終了）+ 短い詳細
- プロトコル（stdio）: MCP stdio transport = 改行区切り JSON-RPC。
  1. 起動後、stdin に 1 行で送信: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"agent-cockpit","version":"0.1.0"}}}` + `\n`
  2. stdout を行バッファし、`"id":1` を含む JSON 行をパース。`result` があれば成功、`error` なら失敗（メッセージ表示）
  3. 判定後 `{"jsonrpc":"2.0","method":"notifications/initialized"}` は **送らずに** プロセスを終了してよい（テスト目的のため）
- プロトコル（http/sse）: `fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...フォームのheaders }, body: initialize（上記と同じ） })`。
  - 2xx なら成功扱い（body の JSON-RPC result まで見られたら serverInfo も表示）。SSE 応答（`text/event-stream`）は最初のイベントのみ読んで打ち切る。4xx/5xx は失敗 + status 表示
  - **注意**: main プロセスの fetch を使う（renderer は CSP で外部接続不可）。タイムアウトは `AbortSignal.timeout(ms)`

## 実装手順

### 1. lib: プロトコルの純粋部分（`src/lib/mcp-probe.ts` 新規）

子プロセス・fetch は main の仕事。lib にはメッセージ生成とレスポンス解析だけ置く（=100%テスト可能）:

```ts
export function initializeRequestJson(): string;            // 上記 JSON + "\n"
export interface ProbeResult { ok: boolean; phase: "spawn"|"timeout"|"protocol"|"exit"|"http"; detail: string; serverName?: string; serverVersion?: string; elapsedMs: number }
/** stdout に溜まった行群から id:1 のレスポンスを探して判定。見つからなければ null */
export function parseInitializeResponse(lines: string[]): { ok: boolean; detail: string; serverName?: string; serverVersion?: string } | null;
```

`parseInitializeResponse` の分岐: JSON でない行スキップ / id 不一致スキップ / error あり / result.serverInfo あり / result はあるが serverInfo なし。

### 2. main: 実行部（`src/main/mcp-probe.ts` 新規）

```ts
export async function probeStdio(command: string, args: string[], env: Record<string,string>, timeoutMs: number): Promise<ProbeResult>;
export async function probeHttp(url: string, headers: Record<string,string>, timeoutMs: number): Promise<ProbeResult>;
```

- `spawn(command, args, { env: { ...process.env, ...env }, stdio: ["pipe","pipe","pipe"] })`
- `error` イベント → phase "spawn"（ENOENT はコマンド名を含めた分かりやすい detail に）
- stdout `data` → 4KB 上限で行分割 → `parseInitializeResponse` → 決着したら kill して resolve
- exit（判定前）→ phase "exit"（code とマスク済み stderr 先頭 300 文字）
- **command のバリデーション**: 空文字は即失敗。パス allowlist は適用しない（npx 等 PATH 上のコマンドが正当）— ただし `command` に改行を含む場合は拒否

### 3. IPC + UI

- `CHANNELS.mcpTest = "cockpit:mcp-test"` / `CockpitApi.mcpTest(input: McpInput, timeoutSec?: number): Promise<ProbeResult>`（00-conventions §3 の手順で3点セット追加）
- main ハンドラ: `input.transport === "stdio" ? probeStdio(...) : probeHttp(...)`。マスクは `mcpSecretValues(input.env, input.headers)` を使用
- McpEditor: `Test` ボタン + 結果バナー（`.banner` + 成功時は独自 `.banner-ok` を styles.css に追加: `--ok` ベース）。実行中は `Testing…` 表示

## テスト

- `tests/mcp-probe.test.ts`（lib 分のみ・全分岐）: initializeRequestJson の形 / parseInitializeResponse の 5 分岐
- main 実行部の実プロセステスト（推奨・ゲート対象外）: `tests/mcp-probe-main.test.ts` で `node -e 'スクリプト'` を command にした本物の spawn テスト:
  - 成功系: `process.stdin.on("data", ...)` で initialize を受けて result を返すワンライナー
  - タイムアウト系: 何も返さないワンライナー + timeoutMs 500
  - spawn 失敗系: 存在しないコマンド名
  - CI(ubuntu) でも動く node ワンライナーのみ使うこと

## 検証（実機)

1. ゲート一式 green
2. `npx electron .` → keyway（stdio）で Test → 成功バナー（serverInfo 表示）
3. mdn（http）で Test → 成功
4. 新規フォームに `command: no-such-cmd` で Test → spawn 失敗が即時表示
5. `command: sleep, args: [30]` 相当で Test → 10 秒でタイムアウト表示・プロセスが残っていないこと（`pgrep sleep`）

## 完了条件

- [ ] 検証 5 点 pass
- [ ] lib 100%×4 維持
- [ ] shell: false / タイムアウト / 4KB 上限 / stderr マスクの4点をコードレビューで確認できる
- [ ] portal（my-apps-portal projects.ts）の「実行時のネットワーク通信ゼロ」注記はユーザー操作起点なら矛盾しないが、`securityScores.notes` を「通信はユーザー操作の Test 実行時のみ」に更新する PR を別途提案（このリポジトリ外なので実装はしない）
