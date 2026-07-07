# 10. ウィンドウ状態・セクション永続化

## 背景 / 目的

起動のたびにウィンドウが 1280×820 の初期位置・MCP セクションに戻る。前回のウィンドウ矩形と表示セクションを復元する。

## 仕様

- ウィンドウの位置・サイズを終了時に保存し、次回起動で復元。復元矩形が現在のディスプレイ外なら初期値にフォールバック（外部モニタ取り外し対策）
- 最後に表示していたセクション（Section 型: "mcp"〜"backups"）とエージェントフィルタを復元
- 保存先: ウィンドウ矩形 = `userData/app-config.json`（既存の state.ts を拡張）。セクション/フィルタ = renderer の `localStorage`（main を経由する必要がない純 UI 状態のため）

## 実装手順

### 1. main: ウィンドウ矩形

`src/main/state.ts` の `AppConfig` に `windowBounds?: { x: number; y: number; width: number; height: number }` を追加（`loadAppConfig` は不正値を無視して undefined に）。

`src/main/index.ts` `createWindow()`:

```ts
const saved = loadAppConfig(userData()).windowBounds;
const visible = saved && screen.getAllDisplays().some((d) => {
  const a = d.workArea;
  return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
});
new BrowserWindow({ ...(visible ? saved : { width: 1280, height: 820 }), ... })
```

保存タイミング: `resize`/`move` を 500ms デバウンスで `saveAppConfig`（`mainWindow.getBounds()`）。`close` でも即保存。`screen` は `electron` から import（app ready 後のみ使用可 — createWindow は whenReady 内なので問題なし）。

### 2. renderer: セクション/フィルタ

`src/renderer/src/store.ts`:

```ts
const persisted = (() => {
  try { return JSON.parse(localStorage.getItem("ui-state") ?? "{}") as { section?: Section; agentFilter?: AgentId | "all" }; }
  catch { return {}; }
})();
```

- 初期値: `section: isValidSection(persisted.section) ? persisted.section : "mcp"`（バリデータを書く — 古いビルドの値や手書き破損に耐える）
- `setSection` / `setAgentFilter` 内で `localStorage.setItem("ui-state", JSON.stringify({ section, agentFilter }))`
- **注意**: `selectedId` は永続化しない（エンティティは再スキャンで消えている可能性があり、無効 id は単に未選択表示になるだけだが、意図しない編集ペイン展開を避ける）

## テスト

- lib 変更なし（isValidSection を store 内に書く場合）。**もし** バリデータ等を関数として切り出すなら lib ではなく renderer 配下に置く（lib はドメイン層。UI 状態は入れない）
- main の bounds 妥当性判定（ディスプレイ交差判定）は純粋関数 `boundsVisible(bounds, workAreas)` として `src/lib/` …ではなく **main 内に置き**、`tests/` からは import しない（electron.screen 依存を切り離した純関数にするなら lib/window-bounds.ts に置いて 100% テスト — こちらを推奨）:

```ts
// src/lib/window-bounds.ts
export interface Rect { x: number; y: number; width: number; height: number }
export function boundsVisible(saved: Rect, workAreas: Rect[]): boolean;
```

`tests/window-bounds.test.ts`: 完全内包 / 部分交差 / 完全外 / 空 workAreas。

## 検証（実機）

1. ゲート一式 green
2. ウィンドウを移動・リサイズ → Skills タブ + Codex フィルタにして終了 → 再起動 → 全て復元されていること
3. `userData/app-config.json`（`~/Library/Application Support/agent-cockpit/`）に windowBounds が書かれ、**projects 配列が壊れていない** こと
4. ディスプレイ外フォールバック: app-config.json の windowBounds.x を 99999 に手書き → 起動 → 初期サイズ・画面内に出ること

## 完了条件

- [ ] 検証 4 点 pass
- [ ] lib 100%×4 維持（window-bounds.ts を lib に置いた場合その全分岐）
- [ ] 既存の projects 永続化（Add folder）と干渉しない（追加→再起動→残存を確認）
