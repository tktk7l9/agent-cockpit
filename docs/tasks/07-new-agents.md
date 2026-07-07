# 07. 他エージェント対応（Gemini CLI / opencode / Copilot CLI）

## 背景 / 目的

lib のアダプタ構造上、エージェント追加は定型作業にできる。本手順書は「1エージェント追加の一般手順」+ 候補3つの調査メモ。**このマシンには対象ツールの実設定がほぼ存在しない**（`~/.copilot` は空同然、`~/.gemini`・`~/.config/opencode` は不在）ため、**最初の工程は必ずフォーマットの実地調査**とする。

## 工程 0: フォーマット調査（スキップ禁止）

実装前に必ず: 対象 CLI の公式ドキュメント（および可能ならローカルにインストールして生成される実ファイル）で以下を確認し、調査結果を PR 説明に貼る:

1. ユーザースコープ設定のパスと形式（JSON/TOML/YAML）
2. MCP サーバー定義のキー構造（stdio/remote の表現・env の持ち方）
3. skills / agents / instructions に相当する概念の有無とパス
4. プロジェクトスコープの仕組み
5. **書込時の安全性**: そのファイルに CLI が他の状態を同居させるか（~/.claude.json 型なら外科的編集必須）

調査メモ（2026-07 時点の participant 知識 — **鵜呑みにせず検証すること**）:
- **Gemini CLI**: `~/.gemini/settings.json`（JSON・`mcpServers` キーあり・`command/args/env` + `url` 形式は Claude 類似）、instructions は `GEMINI.md`。プロジェクトは `.gemini/settings.json`
- **opencode**: `~/.config/opencode/opencode.json`（JSON、`mcp` キー。形式が Claude と異なる可能性が高い）、AGENTS.md を読む
- **Copilot CLI**: `~/.copilot/mcp.json` 等。形式流動的

## 工程 1〜n: 追加の一般手順（Gemini を例に）

### 1. 型とスキャン

- `src/lib/model/types.ts`: `AgentId` に `"gemini"` を追加。**この union を widen すると UI の網羅 switch/Record が typecheck で全部落ちる — それが TODO リストになる**（`AGENT_LABEL`、フィルタチップ配列 `AGENTS`、styles.css の `.badge-gemini` / `.chip-gemini` 色追加）
- `src/lib/paths.ts`: `geminiDir(home)` 等のパス関数 + `scanSpec` に files/dirs を追加（`SnapshotTag` に必要なら新タグ。既存タグ（mcpJson/skill/instructions…）で表現できるならタグは増やさない — 例: Gemini の settings.json が `{mcpServers}` 単純形なら `mcpJson` タグ + `agent: "gemini"` で済むが、他キー同居なら専用タグ）
- `watchPaths` は scanSpec から導出されるので自動で追従

### 2. リーダー

- `src/lib/agents/gemini.ts` 新規。既存 `cursor`（単純 JSON）か `codex`（TOML・状態同居）のうち近い方を雛形に
- `src/lib/inventory.ts` にケース追加。エラーは `fail(path, e)` で継続

### 3. 書込

- MCP 編集対象にするなら: `McpSource` / `McpTargetRef` に `{ kind: "gemini" }` を追加 → `planUpsertMcp`/`planDeleteMcp` の分岐追加（JSON なら `mcpJsonPath` 系の流用、**他キー同居ファイルなら jsonc の外科的編集のみ**）→ `oldMcpSecrets` の分岐 → McpView `targetOptions` に追加
- instructions（GEMINI.md）は `writeRaw` がそのまま使える（scanSpec にタグを足すだけ）

### 4. テスト

追加した全リーダー・全プランナ分岐を合成フィクスチャでカバー（100%ゲートが強制する）。`tests/paths.test.ts` の scanSpec テストに新サーフェスを追加。

### 5. UI 仕上げ

- `components/ui.tsx` `AGENT_LABEL` / App.tsx `AGENTS` / styles.css バッジ・チップ色（CSS 変数 `--gemini` を定義。色はブランド由来で他と衝突しないもの）
- README.md の対応表に列を追加

## 検証

- 対象 CLI をインストールし、実設定を作ってスキャン表示 → 編集 → CLI 側で反映確認（例: `gemini mcp list` 相当）→ Backups で復元、の往復
- 実 CLI を用意できない場合は **リリースに含めない**（読み取り表示のみで出す判断はユーザーに仰ぐ）

## 完了条件（1エージェントごと)

- [ ] 工程 0 の調査結果が PR に記載されている
- [ ] lib 100%×4 維持
- [ ] 既存 3 エージェントのテスト・表示が無変化（回帰なし）
- [ ] 実 CLI での往復検証 pass（不可なら read-only でユーザー判断を仰いだ記録）
