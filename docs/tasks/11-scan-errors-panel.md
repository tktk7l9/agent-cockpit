# 11. スキャンエラー詳細パネル

## 背景 / 目的

パースに失敗した設定ファイル（`ScanResultPayload.errors: { path, message }[]`）は、現状サイドバー下部の「⚠ N file(s) could not be parsed」の **title ツールチップ** でしか見られない。クリックで詳細モーダルを開き、各エラーに対処アクションを付ける。

## 仕様

- サイドバーの `.scan-errors` をボタン化。クリックでモーダル表示
- モーダル内容: エラーごとに 1 行 — `path`（`.mono`・省略表示 + title）/ `message` / アクション 2 つ:
  - `Reveal in Finder`（既存 `RevealButton`）
  - `Open raw`（そのファイルが settings 系で SettingsEntity として読めている場合のみ → 該当エンティティへジャンプ。パース失敗ファイルはエンティティ化されていないことが多いので、無ければ非表示）
- エラー 0 件のときは `.scan-errors` 自体を非表示（現状挙動を維持）
- 再スキャン（Rescan）ボタンをモーダル footer に置く（`refresh()` を呼ぶだけ）

## 実装手順

1. `src/renderer/src/store.ts`: `errorsOpen: boolean` + open/close アクションを追加
2. 新規 `src/renderer/src/components/ScanErrorsModal.tsx`: `.modal-backdrop`/`.modal` 流用。`data.errors` を表示。「Open raw」は `data.entities.find(e => e.kind === "settings" && e.filePath === err.path)` が見つかった場合のみ `setSection("settings"); select(id); close()`
3. `App.tsx`: `.scan-errors` を `<button>` に変更（スタイルは現行踏襲 + hover）。モーダルを DiffModal と並べてマウント
4. アクセシビリティ: モーダルに `role="dialog"` `aria-label="Scan errors"`、Esc で閉じる（backdrop クリックは既存踏襲）

## テスト

lib 変更なし。typecheck green のみ。エラー表示自体の動作確認は検証手順で。

## 検証（実機）

1. ゲート一式 green
2. わざと壊す: `echo "{broken" > /tmp/なんとか` ではなく**安全な対象**で行う — 例: `~/.cursor/mcp.json`（現在 0 byte）に `{broken` を書く → アプリの watcher が拾い、サイドバーに ⚠ 1 → クリック → モーダルに path と jsonc のエラーメッセージ → Reveal が Finder を開く
3. `~/.cursor/mcp.json` を空に戻す（`: > ~/.cursor/mcp.json`）→ Rescan → ⚠ が消える
4. エラー 0 件時に UI 上どこにも痕跡がないこと

## 完了条件

- [ ] 検証 pass（壊したファイルの復旧まで）
- [ ] typecheck / coverage / build green
- [ ] エラーメッセージにファイル内容そのものが混ざらないこと（message はパーサ由来の短文のみ — env 値等の漏洩防止）
