# 04. conflict 時の下書き保持・再適用

## 背景 / 目的

編集中に外部（Claude Code 本体・エディタ・git）が設定ファイルを書き換えると、watcher 経由で stale バナーが出るが、現状の選択肢は「Reload (discard draft)」のみ。編集内容を捨てずに済む導線を足す。

## 現状の挙動（コード読解の起点）

- `src/main/watcher` → `CHANNELS.changed` → `store.markStaleOrRefresh()`:
  - `dirty || preview` なら `stale: true`（App.tsx が `.banner-top` を表示）
  - そうでなければ即 `refresh()`
- 重要な事実: **保存フロー自体は既に conflict-safe**。`preview` は main が fresh disk を読んで planMutation するので、外部変更後に Save… を押しても「現在のディスク内容 + 自分のドラフト」の正しい差分が出る。apply も preview 時の baseHash を照合する。つまり「下書きを保持したまま保存を試みる」は **既存の Save… ボタンを押すだけで成立している**
- 問題は UX: バナーが「破棄して再読込」しか提示せず、ユーザーが Save… を押してよいと分からない。また refresh するとエンティティ再マウント（`key={id}`）でドラフトが消える

## 仕様

1. stale バナーの文言とボタンを変更:
   - 文言: `Config files changed on disk. Your draft is still intact — you can keep editing and Save… (the diff preview always compares against the current file).`
   - ボタン1: `Reload (discard draft)` — 既存の refresh
   - ボタン2: なし（Save… は各エディタに既にある。バナーに保存ボタンを重複させない）
2. DiffModal 内 conflict バナー（apply 時に baseHash 不一致になったケース）に **`Re-preview` ボタン** を追加: 現在の mutation で `requestPreview` を再実行し、モーダルの差分と baseHash を最新化する（現状は閉じて手動で Save… し直すしかない）
3. refresh 後のドラフト消失は仕様として許容（Reload は明示的な破棄操作なので）。自動マージは実装しない

## 実装手順

### 1. store

`src/renderer/src/store.ts`:

- `PreviewState` は `mutation` を保持済み。`repreview()` アクションを追加:

```ts
repreview: async () => {
  const p = get().preview;
  if (!p?.mutation) return;               // restore preview は対象外
  const result = await window.cockpit.preview(p.mutation);
  if (!result.ok) { get().showToast("err", result.error); set({ preview: null }); return; }
  set({ preview: { mutation: p.mutation, files: result.files, applying: false } }); // conflictPath をクリア
},
```

- restore（`mutation: null`）の場合の Re-preview: `requestRestorePreview(p.restoreId)` を呼ぶ分岐にしてもよい（実装するなら restoreId の undefined ガード必須）

### 2. DiffModal

`src/renderer/src/components/DiffModal.tsx` の conflict バナーに:

```tsx
<button className="btn btn-small" onClick={() => void repreview()}>Re-preview</button>
```

文言も「close して再編集」から「Re-preview で最新の差分に更新できる」旨に変更。

### 3. App.tsx バナー文言

仕様 1 の通り差し替え。`stale` フラグは preview 成功（apply ok → refresh）でも解除される既存挙動のままで良い。

## テスト

lib 変更なし（store/UI のみ）→ 新規 lib テスト不要。ただし:
- `npm run typecheck` / 既存テスト green を維持
- 挙動検証は下記の実機手順で担保する

## 検証（実機・必須）

1. `npx electron .` 起動 → Skills で任意 skill の body を編集（Save しない）
2. 別ターミナルで同じ SKILL.md に `echo "external change" >> <path>` — バナーが新文言で出て、**エディタのドラフトが残っている** こと
3. そのまま Save… → DiffModal の差分が「外部変更後のファイル + 自分のドラフト」ベースであること → Cancel
4. conflict 経路: Save… でプレビューを開いたまま、外部でもう一度ファイルを変更 → Apply → conflict バナー → `Re-preview` → 差分が更新され Apply が通ること
5. 最後に対象 skill をアプリの Backups から復元（または git で戻し）、実験痕を残さない

## 完了条件

- [ ] 検証 1–5 pass
- [ ] typecheck / coverage / build green（lib 100% 維持 — lib に手を入れていないので自然に維持されるはず）
- [ ] restore プレビュー（Backups タブ）で Re-preview を押したときにクラッシュしないこと（分岐未実装なら非表示にする）
