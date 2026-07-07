# 02. `.mcp.json` サーバーの有効/無効トグル

## 背景 / 目的

プロジェクトの `.mcp.json` に定義された MCP サーバーは、Claude Code 側の承認状態が `~/.claude.json` の `projects[<path>].enabledMcpjsonServers` / `disabledMcpjsonServers`（string 配列）に記録される。現状アプリは disabled を **表示するだけ**（McpView の `disabled` pill）。これを GUI からトグルできるようにする。

## 前提知識（コードの現状）

- 読み側: `parseClaudeGlobal`（src/lib/agents/claude.ts）が両配列をパース済み。`buildInventory`（src/lib/inventory.ts の `case "mcpJson"`) が `enabled = !gates.disabledMcpjsonServers.includes(name)` を設定
- `.mcp.json` 由来のエンティティは `source: { kind: "mcpjson" }`・`scope: { level: "project", projectPath }`・`enabled?: boolean`
- `~/.claude.json` のパスは renderer では `${data.home}/.claude.json` で組める
- 参考: `~/.claude.json` の projects エントリには `enableAllProjectMcpServers: boolean` が存在する場合がある（全許可フラグ）。**本タスクでは読み書きしない** が、UI 注記に使う（下記）

## 仕様

- McpView で `source.kind === "mcpjson"` のサーバーを選択したとき、エディタ上部に有効/無効スイッチ（`.switch` クラス流用）を表示
- トグル ON（有効化）: `disabledMcpjsonServers` から name を除去し、`enabledMcpjsonServers` に name を追加（重複追加しない）
- トグル OFF（無効化）: `enabledMcpjsonServers` から除去し、`disabledMcpjsonServers` に追加
- 書込先はどちらも `~/.claude.json` の `projects[<projectPath>]` 配下。**他のキーには一切触れない**
- 通常の差分プレビュー（DiffModal）→ apply の経路に乗せる
- cursor の mcp.json（`source.kind === "cursor"`）にはこの概念がないので表示しない

## 実装手順

### 1. lib: Mutation 追加

`src/lib/mutations.ts`:

```ts
| { op: "toggleMcpJsonServer"; claudeJsonPath: string; projectPath: string; name: string; enabled: boolean }
```

プランナ `planToggleMcpJsonServer(ctx, m)`:
1. `text = ctx.snapshot(m.claudeJsonPath)`。null なら throw（`.mcp.json` を承認した時点で必ず存在するファイル）
2. `parseClaudeGlobal(text)` で現在の両配列を取得（プロジェクトエントリ不在なら空配列扱い — `parseClaudeGlobal` が既にそう返す）
3. 新配列を計算:
   - enabled=true: `enabledNew = 現enabled ∪ {name}`（順序維持・末尾追加）, `disabledNew = 現disabled − {name}`
   - enabled=false: その逆
4. `setJsonValue` を2回適用（`["projects", projectPath, "enabledMcpjsonServers"]` と同 disabled）。**配列はこの機能が所有するキーなので丸ごと置換でよい**（外科的編集の対象はキー単位）
5. 変化がない場合（既に希望状態）もそのまま newText を返してよい — DiffModal 側が「no textual change」表示で Apply を無効化する
6. `mutationReadPaths` に `[m.claudeJsonPath]` を追加

### 2. inventory: enabled 判定の精密化

現状 `enabled = !disabled.includes(name)` だが、enabled 配列も見るよう変更:

```ts
disabled.includes(name) → false
enabled.includes(name)  → true
どちらにも無い          → undefined（未承認 = Claude Code 起動時に確認される状態）
```

`McpServerEntity.enabled` は `boolean | undefined` のまま。McpView のリスト行は `enabled === false` → `disabled` pill（既存）、`undefined` → `unapproved` の `.tag` を追加表示。

### 3. renderer: McpView 拡張

`McpEditor` 内、`entity.source.kind === "mcpjson"` のとき:

```tsx
<div className="field">
  <label>Claude Code approval</label>
  <switch> … onClick={() => requestPreview({ op: "toggleMcpJsonServer", claudeJsonPath: `${home}/.claude.json`, projectPath, name: entity.name, enabled: !(entity.enabled ?? false) })}
  <p className="muted small">Stored in ~/.claude.json (projects.{path}). enableAllProjectMcpServers が設定されている場合はそちらが優先されることがある。</p>
</div>
```

`projectPath` は `entity.scope.level === "project"` の narrowing 後に取得。`home` は props で受け取り済み。

## テスト

`tests/mutations.test.ts` に追記（または新 describe）:
- 有効化: disabled から消え enabled に入る。**decoy キー（projects の他フィールド・トップレベル他キー）がバイト単位で不変**
- 無効化: 逆方向
- 両配列に元々居ない name の有効化（enabled への純追加）
- 既に希望状態のトグル（冪等）
- projects にエントリ自体が無いプロジェクトパスでの有効化（jsonc modify が中間キーを自動生成することを確認）
- ファイル不在で throw
- `mutationReadPaths` のケース追加

`tests/inventory.test.ts`: enabled 配列に載っている場合 true / どちらにも無い場合 undefined のケースを追加（既存フィクスチャの `enabledMcpjsonServers: ["a"]` を活用）。

## 検証

1. ゲート一式 green
2. 実機: 任意のプロジェクトの `.mcp.json` サーバー（例: utility-tracker の supabase）を無効化 → DiffModal の差分が `disabledMcpjsonServers` 追加のみであること → Apply → `claude` CLI をそのプロジェクトで起動し `/mcp` で無効になっていること → 元に戻す
3. Apply 前後の `~/.claude.json` を `git diff --no-index`（バックアップと比較）し、対象2キー以外の変化がゼロであること

## 完了条件

- [ ] 検証 3 点 pass（特に実機の戻し確認まで）
- [ ] lib 100%×4 維持
- [ ] cursor ソースのサーバーにスイッチが出ないこと
- [ ] `enableAllProjectMcpServers` には触れていないこと（grep で確認）
