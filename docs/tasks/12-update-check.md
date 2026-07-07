# 12. 手動アップデートチェック

## 背景 / 目的

未署名アプリなので electron-updater による自動更新は使えない。GitHub Releases の最新タグと起動中バージョンを比較し、新しければリリースページへ誘導する **手動** チェックを付ける。

**プライバシー制約**: portal に「実行時のネットワーク通信ゼロ」と掲載している。よって **自動チェックは実装しない**。通信はユーザーがボタンを押したときのみ。この制約を破る実装（起動時チェック・定期チェック）は不合格。

## 仕様

- サイドバー下部（agent-filter の上）に小さく `v0.1.0 — Check for updates` テキストボタン
- クリック → main が `https://api.github.com/repos/tktk7l9/agent-cockpit/releases/latest` を fetch（10 秒タイムアウト）
- 結果:
  - 新しい: バナー/トースト `New version v0.2.0 available` + `Open Releases` ボタン（`shell.openExternal("https://github.com/tktk7l9/agent-cockpit/releases/latest")`）
  - 最新: トースト `You're up to date (v0.1.0)`
  - 失敗（オフライン・rate limit）: トースト `Update check failed: <短い理由>`
- バージョン比較: semver の major.minor.patch 数値比較。プレリリースサフィックスは「リリース側にあれば無視して本体だけ比較」で十分

## 実装手順

### 1. lib: バージョン比較（新規 `src/lib/version.ts`）

```ts
/** "v1.2.3" / "1.2.3" / "1.2.3-beta.1" を {major,minor,patch} に。パース不能は null */
export function parseVersion(tag: string): { major: number; minor: number; patch: number } | null;
/** a > b なら 1, 等しければ 0, a < b なら -1。どちらか parse 不能なら null */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null;
```

### 2. main + IPC

- `CHANNELS.checkUpdate = "cockpit:check-update"` / `CockpitApi.checkUpdate(): Promise<UpdateCheckResult>`:

```ts
export type UpdateCheckResult =
  | { status: "update-available"; current: string; latest: string; url: string }
  | { status: "up-to-date"; current: string }
  | { status: "error"; message: string };
```

- main ハンドラ: `app.getVersion()`（= package.json version が electron-builder で埋まる。dev 実行時は electron 自身のバージョンになる場合があるので `app.isPackaged ? app.getVersion() : パッケージjsonから` … 簡潔には `process.env.npm_package_version` に頼らず、ビルド時定数 `import.meta.env` は main では使わない — **`app.getVersion()` をそのまま使い、dev では結果表示だけ確認** で割り切る）
- fetch: Node 22 のグローバル fetch + `AbortSignal.timeout(10_000)`。ヘッダ `Accept: application/vnd.github+json`、`User-Agent: agent-cockpit`。レスポンスの `tag_name` を `compareVersions` へ
- `shell.openExternal` は URL を `https://github.com/tktk7l9/agent-cockpit/` 前綴り固定（レスポンス中の任意 URL を開かない — API 改竄への防御）

### 3. renderer

サイドバー footer にボタン + 結果は既存 toast（`showToast`）。update-available のときのみ `.banner` をサイドバー下部に出し `Open Releases` を置く（store に `updateInfo` を持たせる）。

### 4. リリース手順への追記

`docs/tasks/00-conventions.md` は変更しない。代わりに README.md の Development 節に1行追記: リリース時は package.json の version を上げてから `npm run package` → `gh release create v<ver> <dmg> <zip>`（タグとバージョンの一致が本機能の前提）。

## テスト

- `tests/version.test.ts`（全分岐）: parseVersion 正常 / v プレフィクス / プレリリース / 不正文字列 null。compareVersions 大小・同値・不能 null
- fetch 部はテスト対象外（main）。手動検証で担保

## 検証

1. ゲート一式 green
2. `npx electron .` → Check for updates → 現在 v0.1.0 = 最新なら up-to-date トースト
3. 一時的に package.json の version を 0.0.1 にして build → update-available バナー + Open Releases でブラウザが開く → version を戻す
4. ネットワーク遮断（Wi-Fi off）で error トースト。アプリがフリーズしない
5. **通信タイミングの確認**: 起動しただけでは GitHub API に一切アクセスしないこと（Console.app や `nettop` での確認、またはハンドラ以外に fetch 呼び出しがないことの grep で可）

## 完了条件

- [ ] 検証 5 点 pass（特に 5）
- [ ] lib 100%×4 維持
- [ ] openExternal の URL が固定プレフィクスであること
- [ ] portal の「通信ゼロ」注記の更新提案（ユーザー操作起点のみ、の文言）を PR 説明に含める（portal 自体の変更はしない）
