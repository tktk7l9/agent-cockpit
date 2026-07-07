# 改善タスク手順書

agent-cockpit の改善タスク一覧。各手順書は **このリポジトリを初めて見る AI エージェントが単独で実装を完遂できる** ことを目標に書かれている。

**着手前に必ず [00-conventions.md](00-conventions.md) を読むこと。** 全タスク共通の絶対規約（lib 純粋性・100%カバレッジゲート・外科的編集・セキュリティ不変条件）はそこに集約されており、各手順書はそれを前提に書かれている。

## 一覧（推奨着手順）

| # | タスク | 規模 | 価値 | 依存 |
|---|---|---|---|---|
| [01](01-command-palette.md) | Cmd+K コマンドパレット（横断検索） | 半日 | ★★★ | なし |
| [02](02-mcpjson-toggle.md) | .mcp.json サーバーの有効/無効トグル | 小 | ★★★ | なし |
| [03](03-permissions-editor.md) | permissions 専用エディタ | 小 | ★★ | なし |
| [04](04-conflict-draft.md) | conflict 時の下書き保持・再適用 | 小 | ★★ | なし |
| [05](05-skill-sync.md) | Skill の Claude⇄Cursor 比較・同期 | 1日 | ★★★ | なし |
| [06](06-mcp-healthcheck.md) | MCP サーバーのヘルスチェック | 1日 | ★★★ | なし |
| [07](07-new-agents.md) | 他エージェント対応（Gemini CLI 等） | 1日/件 | ★ | なし |
| [08](08-bundle-split.md) | レンダラーバンドル分割 | 小 | ★ | なし |
| [09](09-light-theme.md) | ライトテーマ対応 | 小 | ★ | なし |
| [10](10-window-state.md) | ウィンドウ状態・セクション永続化 | 小 | ★ | なし |
| [11](11-scan-errors-panel.md) | スキャンエラー詳細パネル | 小 | ★ | なし |
| [12](12-update-check.md) | 手動アップデートチェック | 小 | ★ | なし |

依存関係はないので任意の1本だけ実装してよい。ただし同時に複数実装する場合、01/05/06 は store・IPC に手を入れるためコンフリクトしやすい — 1本ずつ完了（テスト green + commit）させること。

## 完了の定義（全タスク共通）

1. `npm run typecheck` green（node/web 両方）
2. `npm run coverage` green — **src/lib は 100/100/100/100 を維持**（1ブランチでも欠けると CI が落ちる）
3. `npm run build` 成功
4. `npm audit` 脆弱性 0 件を維持
5. 手順書ごとの「検証」セクションを実施し結果を報告
6. 手順書ごとの「完了条件」を全て満たす
