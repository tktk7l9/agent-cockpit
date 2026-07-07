# 09. ライトテーマ対応

## 背景 / 目的

現在ダークテーマ固定。macOS の外観設定（`prefers-color-scheme`）に自動追従するライトテーマを追加する。手動トグルは実装しない（OS 追従のみ — 設定 UI を持たないアプリの複雑化を避ける）。

## 仕様

- `prefers-color-scheme: light` のとき全 UI がライト配色になる。切替は OS 設定変更に即時追従（メディアクエリなので自動）
- エージェントカラー（--claude/--codex/--cursor）は両テーマ共通。ただしライトでの視認性を確認し、必要なら明度を微調整した `--claude-fg` 系を導入してよい
- CodeMirror エディタと差分表示もライト配色に追従する
- ウィンドウ背景（main プロセスの `backgroundColor: "#101418"`）とタイトルバーも追従する

## 実装手順

### 1. CSS（大部分はこれで終わる）

`src/renderer/src/styles.css` の `:root` 直後に追加:

```css
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f5f7fa;
    --bg-panel: #ffffff;
    --bg-raised: #eef1f5;
    --border: #d5dce4;
    --text: #1f2933;
    --text-muted: #64748b;
    --accent: #0969da;
    --accent-soft: rgba(9, 105, 218, 0.12);
    /* ok/warn/danger はライトで沈む場合のみ調整 */
  }
}
```

- rgba 直書き箇所を洗い出す: `grep -n "rgba(" src/renderer/src/styles.css`。黒背景前提の白 rgba（`.switch` トラック、`.diff-add/del` の背景等）は CSS 変数化してライト側で差し替える
- `.modal-backdrop` の黒 55% はライトでも成立するので据え置き可

### 2. CodeMirror テーマ

`CodeEditor.tsx` の `theme` は `{ dark: true }` 固定。対応:

```ts
const isDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
```

- ライト用 `EditorView.theme({...}, { dark: false })` を用意し、Compartment で保持。`matchMedia(...).addEventListener("change", ...)` で `dispatch({ effects: themeComp.reconfigure(...) })`（readOnly と同じ Compartment パターンが既にあるので踏襲）
- 配色: caret/selection の `#7dd3fc` 系をライトでは `#0969da` 系に

### 3. main プロセス

`src/main/index.ts`:

```ts
import { nativeTheme } from "electron";
backgroundColor: nativeTheme.shouldUseDarkColors ? "#101418" : "#f5f7fa",
```

- 起動後の切替: `nativeTheme.on("updated", ...)` で `mainWindow.setBackgroundColor(...)`（ちらつき防止のみが目的なので renderer 側 CSS が既に追従していれば必須ではないが、リサイズ時の下地色が合う）

## テスト

lib 変更なし。typecheck green のみ。

## 検証（実機・目視）

1. システム設定 → 外観をライトに → アプリ全ビュー（9 セクション + DiffModal + パレット類）を目視。文字が読めない・境界が消える箇所ゼロ
2. ダークに戻して回帰なし
3. アプリ起動中に外観を切り替えて即時追従（再起動不要）
4. CodeMirror（Skills の body・Settings の raw・差分表示）がライトで読めること
5. スクリーンショットを両テーマで撮って PR に添付

## 完了条件

- [ ] 検証 5 点 pass
- [ ] ハードコード色の残りが `grep -n "#[0-9a-fA-F]\{3,6\}" src/renderer/src/styles.css` で意図済みのもの（CSS 変数定義・両テーマ共通色）のみ
- [ ] AgentBadge / チップ / pill / switch / toast がライトでコントラスト十分（WCAG AA 目安）
