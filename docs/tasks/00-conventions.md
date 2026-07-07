# 00. 共通規約（全タスク必読）

このファイルは全手順書の前提。ここに書かれた不変条件を破る実装は、機能が動いていても **不合格**。

## 1. リポジトリの構造と責務

```
src/
├── lib/        # 純関数のみ。electron・node:fs・副作用 禁止。100%カバレッジゲート対象
│   ├── model/types.ts   # ドメインモデル（Entity 7種 × agent × scope）と FileEdit
│   ├── paths.ts         # layout(home)→全設定パス。home は必ず引数注入（ハードコード禁止）
│   ├── json/jsonc-edit.ts   # jsonc-parser による外科的 JSON 編集
│   ├── toml/toml-edit.ts    # toml-eslint-parser AST レンジによる外科的 TOML 編集
│   ├── markdown/frontmatter.ts
│   ├── agents/{claude,codex,cursor}.ts + mcp-common.ts  # 各ツールのリーダー
│   ├── inventory.ts     # TaggedSnapshot[] → Entity[]（読み側の唯一の入口）
│   └── mutations.ts     # Mutation union + planMutation()（書き側の唯一の入口）
├── shared/ipc.ts   # CHANNELS 定数 + CockpitApi 型（renderer↔main の契約）
├── main/           # 薄い I/O アダプタ。index.ts(IPC登録/window) / fs-gateway.ts / scan.ts / state.ts
├── preload/index.ts # contextBridge で window.cockpit のみ公開
└── renderer/src/   # React 19 + zustand(store.ts) + CodeMirror 6。views/ + components/
```

データフロー:
- **読み**: main `runScan(home, manualProjects)` → lib `scanSpec` の指示で fs 収集 → lib `buildInventory` → renderer へ `ScanResultPayload`
- **書き**: renderer が `Mutation` を組む → `window.cockpit.preview(m)` → main が fresh snapshot で lib `planMutation` → 差分を DiffModal 表示 → `apply(m, baseHashes)` → sha256 照合 → バックアップ → atomic write

## 2. 絶対不変条件（破ったら不合格）

1. **lib の純粋性**: `src/lib/**` に `electron` / `node:fs` / `node:child_process` 等の import を追加しない。判断ロジックを main に書きたくなったら、純粋部分を lib に切り出す（例: `isPathAllowed` は lib、`realpathSync` は main）。
2. **100%ゲート**: `vitest.config.ts` の thresholds は 100/100/100/100。**下げる・exclude を増やすのは禁止**。到達不能な防御分岐を書いてしまったら、テストで無理に通すのではなくコードを簡素化する（例: yaml の出力は常に改行終端 → 三項演算子を書かない）。
3. **全体再直列化の禁止**: 設定ファイルを `JSON.stringify(全体)` や TOML 全体再出力で書かない。JSON は `setJsonValue`/`removeJsonKey`（対象サブツリーのみ変更・他はバイト不変）、TOML は `upsertTableBlock`/`setKeyInTable`/`removeTables`（コメント生存）。新しい書込パターンが必要なら jsonc-edit / toml-edit に関数を足し、**no-op 変異でバイト同一**の不変条件テストを付ける。
4. **書込は planMutation 経由のみ**: main から直接 `fs.writeFileSync` で設定ファイルを書かない。新機能の書込は必ず `Mutation` union に op を追加し `planMutation` + `mutationReadPaths` を拡張する。
5. **denylist を弱めない**: `~/.codex/auth.json`・`.env*`・`*credential*`・`*secret*`・`*token*`（`isPathDenied` @ src/lib/paths.ts）。allowlist（`isPathAllowed`）の緩和も禁止。
6. **Electron セキュリティ基線**: contextIsolation:true / sandbox:true / nodeIntegration:false / navigation 全拒否 / リモートコンテンツ読み込みなし / preload は型付き API 1個のみ（生 ipcRenderer を晒さない）。CSP は electron.vite.config.ts の inject-csp プラグインが本番ビルドにのみ注入する（dev は react-refresh の inline script が必要なため注入しない — この構造を変えない）。
7. **フィクスチャは合成データのみ**: 実マシンの設定値・実 API キー・PII をテストやドキュメントにコピーしない。
8. **シークレット表示**: env/header の値は UI でデフォルトマスク・差分でも `maskDiff` でマスク。新 UI でこれらの値を表示する場合も同じ扱いにする。

## 3. 実装パターン集（この通りに書く）

### 新しい Mutation op の追加手順
1. `src/lib/mutations.ts`: `Mutation` union に op を追加 → `planMutation` の switch に純粋なプランナ関数を追加 → `mutationReadPaths` にも必ず追加（apply 時の fresh read 対象）
2. バリデーションは `src/lib/validate.ts` に追加し、プランナ冒頭で throw
3. `tests/mutations.test.ts`（または新テストファイル）に: 正常系 / 異常系(throw) / mutationReadPaths / **対象外のバイトが変わらないこと** のテスト
4. renderer からは `useStore().requestPreview(mutation)` を呼ぶだけ。DiffModal・conflict・バックアップは自動で乗る

### 新しい IPC チャンネルの追加手順
1. `src/shared/ipc.ts`: `CHANNELS` に `"cockpit:<name>"` を追加し、`CockpitApi` にメソッド型を追加
2. `src/preload/index.ts`: `api` オブジェクトに `ipcRenderer.invoke` ラッパを1行追加
3. `src/main/index.ts` `registerIpc()`: `ipcMain.handle(CHANNELS.<name>, ...)` を追加。**ファイルパスを受け取るハンドラは必ず `checkPath()` を通す**
4. renderer: `window.cockpit.<name>()` で呼ぶ（型は preload/api.d.ts 経由で自動で効く）

### 新しいエンティティ種別/フィールドの追加手順
1. `src/lib/model/types.ts` に型追加 → `src/lib/paths.ts` の `scanSpec` にスキャン対象を追加（`SnapshotTag` 拡張）→ `src/lib/inventory.ts` の switch にケース追加
2. `src/main/scan.ts` はタグ種別（files/skillDirs/mdFiles/ruleFiles）で機械的に収集するので、既存 type で表現できるなら変更不要
3. `tests/inventory.test.ts` にハッピーパス + エラー系 + null(不在) 系を追加

### UI 規約
- スタイルは `src/renderer/src/styles.css` の既存クラスを再利用: `.field` `.btn .btn-primary .btn-small .btn-danger .btn-icon` `.pane-head` `.banner .banner-warn` `.pill .pill-add .pill-del` `.tag` `.badge-{claude,codex,cursor,shared}` `.modal-backdrop .modal` `.table` `.switch` `.toast`。色は必ず CSS 変数（`--accent` `--claude` `--codex` `--cursor` 等）経由
- リスト+エディタ2ペイン構成は `McpView.tsx` / `MarkdownEntityView.tsx` を、テーブル構成は `PluginsView.tsx` を雛形にする
- エージェント/スコープ表示は `components/ui.tsx` の `AgentBadge` / `ScopeTag` を使う
- 保存ボタンのラベルは `Save…`（… = 差分プレビューが挟まる合図）。破壊操作は `Delete…`
- コンポーネント state は編集ドラフト用の `useState`、アプリ状態は `store.ts`（zustand）。編集開始時に `setDirty(true)`

## 4. コマンドと完了チェック

```bash
npm run dev          # HMR 開発（Electron ウィンドウが開く）
npm run typecheck    # tsc --noEmit を node/web 2プロジェクトで実行
npm run coverage     # vitest + v8。src/lib は 100/100/100/100 必須
npm run build        # electron-vite build
npm audit            # 0 件維持
npx electron .       # 本番ビルドを起動（build 後）
```

コミット規約: 1タスク=1コミット以上、message は英語 summary + 本文自由。`Co-Authored-By:` 行は実装したモデルに合わせる。CI（.github/workflows/ci.yml）が push で回る: typecheck → coverage → build → audit（ubuntu）+ dmg（macos-14, main のみ）。

## 5. 既知の罠（このセッションで実際に踏んだもの）

| 罠 | 対処 |
|---|---|
| electron-vite 5 は vite 8 非対応 | vite は ^7 に固定済み。**vite を 8 に上げない**。@vitejs/plugin-react も ^4.7 系のまま |
| sandboxed preload は ESM 不可 | preload は CJS ビルド（electron.vite.config.ts で format: "cjs" 指定済み）。変えない |
| chokidar v5 は glob 非対応 | `watchPaths()` が返す明示パスのみ watch する。glob パターンを渡さない |
| CSP と dev モードの衝突 | CSP は本番ビルドのみ inject（inject-csp プラグイン）。index.html に直接 CSP meta を書かない |
| macOS の `/var` は `/private/var` への symlink | パス比較は `resolveAndCheck`（fs-gateway.ts）が realpath 両側比較で吸収済み。新しいパス検証を書くときも同様に |
| バックアップのタイムスタンプ衝突 | 同一 ms 内の連続書込は `-1` `-2` サフィックスで回避済み（writeBackup） |
| `String(yamlDocument)` は常に改行終端 | 末尾改行の防御分岐を書くと 100% ゲートで死ぬ。書かない |
| jsonc-parser `modify` は中間キーを自動生成する | `["projects", path, "mcpServers", name]` のような深いパスも一発で通る。手動で親を作らない |
| 空ファイル（0 byte の ~/.cursor/mcp.json が実在） | JSON リーダーは `text.trim()===""` を `{}` 扱いにする。新リーダーも同様に |
| Entity union の narrowing | `e.kind === "skill"` で絞っても配列 find 経由だと効かないことがある。型ガード関数か `as` を使い typecheck を通す |

## 6. やってはいけないこと（スコープ外）

- 依存の追加は最小限に。追加するなら `npm audit` 0 維持を確認し、目的を commit message に書く。electron-store / Monaco / lodash 類は導入しない
- 自動テレメトリ・自動ネットワーク通信を仕込まない（portal に「実行時のネットワーク通信ゼロ」と掲載している。12番タスクのみ例外で、ユーザー操作起点の通信を許可し portal 記載も更新する）
- `~/.claude.json` の mcpServers / projects.*.mcpServers / enabledMcpjsonServers / disabledMcpjsonServers **以外のキー** に触れる書込を実装しない
- リリース作業（version bump / gh release / portal 更新）は手順書に明記がない限りしない
