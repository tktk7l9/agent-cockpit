# 01. Cmd+K コマンドパレット（横断検索）

## 背景 / 目的

Skill だけで39件あり、リストの目視スキャンが限界。全エンティティ（MCP/Skill/Subagent/Command/Plugin/Settings/Instructions）を1つの入力欄からインクリメンタル検索し、Enter で該当ビューへジャンプできるパレットを追加する。VS Code の Cmd+P / Raycast と同じ操作感。

## 仕様

- **起動**: `⌘K`（グローバル、input/textarea フォーカス中でも有効）。`Esc` で閉じる。パレット表示中は背後スクロールを止める
- **検索対象**: `data.entities` 全件 + 固定アクション（各セクションへ移動 = "Go to MCP Servers" 等9件、"Add project folder…"）
- **マッチング**: 大文字小文字無視の subsequence マッチ（fzf 風）。対象文字列は `name` と、あれば `description`。スコア = 連続一致ボーナス + 先頭一致ボーナス − 位置ペナルティ（詳細は実装に委ねるが決定的であること）
- **表示**: 上位20件。各行 = 種別アイコン文字（MCP=`⚡` Skill=`◆` Subagent=`🤖` Command=`/` Plugin=`🔌` Settings=`⚙` Instructions=`📋`）+ name + `AgentBadge` + `ScopeTag`。`↑↓` で選択、`Enter` で確定、クリックでも確定
- **確定動作**: エンティティ → `setSection(kind)` + `select(id)`。セクション移動アクション → `setSection`。Add project → `window.cockpit.addProject()`
- **クエリ空**: 直近の固定アクション一覧のみ表示（エンティティは出さない）

## 実装手順

### 1. lib: 検索ロジック（100%ゲート対象になる）

新規 `src/lib/search.ts`:

```ts
export interface SearchItem { id: string; label: string; sublabel?: string }
export interface SearchHit { item: SearchItem; score: number }

/** 大小無視 subsequence マッチ。マッチしなければ null。スコアは決定的 */
export function fuzzyScore(query: string, text: string): number | null;
/** items を fuzzyScore(label) → fuzzyScore(sublabel) の順で評価し降順 top N */
export function searchItems(query: string, items: SearchItem[], limit?: number): SearchHit[];
```

- `fuzzyScore` の仕様: query の各文字が text 中に順序通り現れれば一致。基本点 = 一致、+3/連続一致、+5/単語頭一致（先頭 or 直前が `-_./ `）、−0.1×開始位置。query 空は `null` を返す（呼び出し側で空クエリ分岐）
- **注意**: 分岐を書いた分だけテストが要る。仕様にない「賢い」分岐を足さない

### 2. renderer: パレットコンポーネント

新規 `src/renderer/src/components/CommandPalette.tsx`:

- `useStore` から `data` / `setSection` / `select` を取得
- `items` は `useMemo` で構築: エンティティ → `{ id: e.id, label: e.name ?? e.key, sublabel: description等 }` + kind/agent/scope を別 Map で保持。固定アクションは `id: "action:<name>"`
- `⌘K` リスナーは `App.tsx` の `useEffect` で `window.addEventListener("keydown", ...)`（`e.metaKey && e.key === "k"` で preventDefault → store に `paletteOpen: boolean` を追加して開閉）
- 見た目: `.modal-backdrop` を流用し、上から 15vh の位置に幅 560px のパネル。既存 CSS 変数でスタイル追加（`.palette` クラス群を styles.css に追記）
- `PluginEntity` は `name` を持たない（`key`）。`SettingsEntity`/`InstructionsEntity` は `name` あり。union の narrowing に注意（00-conventions §5）

### 3. store 拡張

`src/renderer/src/store.ts` に `paletteOpen: boolean` / `openPalette()` / `closePalette()` を追加。`select` は既存のものを使う（section が違うエンティティへ飛ぶ場合は `setSection` → `select` の順で呼ぶ。`setSection` が selectedId を消すため順序厳守）。

## テスト

`tests/search.test.ts` 新規:
- 一致/不一致/空クエリ null/大文字小文字無視
- スコア順: 完全一致 > 先頭一致 > 散在一致 になる具体例
- 連続一致ボーナス・単語頭ボーナスが効く具体例（`"mcp"` vs `"my-cool-plugin"` と `"mcp-server"` 等）
- `searchItems`: limit 動作・sublabel フォールバック・全不一致で空配列

UI 部分（キーイベント・描画）はゲート対象外なのでテスト必須ではないが、`npm run typecheck` は必ず通す。

## 検証

1. `npm run typecheck && npm run coverage && npm run build` 全 green（lib 100%×4 維持）
2. `npx electron .` → `⌘K` → `keihi` と打って Skill の keihi が最上位に出て Enter でジャンプすること
3. `⌘K` → 空クエリで固定アクションのみ表示 → "Go to Backups" でセクション移動すること
4. エディタ（CodeMirror）フォーカス中でも `⌘K` が開くこと

## 完了条件

- [ ] 上記検証 4 点 pass
- [ ] `fuzzyScore`/`searchItems` が tests/search.test.ts で全分岐カバー
- [ ] パレット表示中に背後の UI 操作が効かない（backdrop クリックで閉じる）
- [ ] 新規依存パッケージなし（fuzzy ライブラリを入れない — 自前実装がテスト対象）
