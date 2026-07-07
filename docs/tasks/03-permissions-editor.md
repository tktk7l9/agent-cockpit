# 03. permissions 専用エディタ

## 背景 / 目的

Claude Code の権限設定（`permissions.allow` / `permissions.deny` の文字列配列、`permissions.defaultMode`）は現状 SettingsView の raw JSON 編集でしか触れない。行単位の追加/削除 UI と defaultMode のドロップダウンを付け、raw を開かず安全に編集できるようにする。

## 対象ファイル（読み書き両方）

- `~/.claude/settings.json`（user）
- `<project>/.claude/settings.json` / `settings.local.json`（project — 実在例: このリポジトリ群では `{ permissions: { allow: [...] } }` のみのファイルが多い）

いずれも既にスキャン済み（`SnapshotTag: claudeSettings` → `SettingsEntity`）。

## 仕様

- SettingsView のエディタペインで、`agent === "claude"` の settings エンティティに **Permissions セクション** を追加（raw エディタの上）
  - `defaultMode`: ドロップダウン。選択肢 = `default` / `acceptEdits` / `plan` / `bypassPermissions` + 「(unset)」+ 自由入力への逃げ道（select に "custom…" を置き、選ぶと text input 表示）。値の網羅は保証しない前提で、**現在値が選択肢に無い場合はそのまま表示** する
  - `allow` / `deny`: それぞれ文字列リストエディタ。1行 = 1ルール（例: `Bash(npm run build)`、`Read(~/.zshrc)`）。行の追加・編集・削除・並びは元の順序維持
- 保存は Permissions セクション専用の Save ボタン（raw の Save とは独立）。1クリックで defaultMode/allow/deny の変更をまとめて1つの差分プレビューにする
- ルール文字列のバリデーションはしない（Claude Code 側の仕様が広いため）。空行だけ除去する

## 実装手順

### 1. lib: known 抽出の拡張

`src/lib/agents/claude.ts` の `claudeSettingsKnown` は quick-edit 用の flat map なので **触らない**。代わりに専用リーダーを追加:

```ts
export interface ClaudePermissions {
  defaultMode?: string;
  allow: string[];
  deny: string[];
  present: boolean; // permissions キー自体の有無
}
export function claudePermissions(text: string | null): ClaudePermissions;
```

配列でない/文字列でない値は無視して安全側に倒す（既存リーダーの `stringList` 相当の防御。分岐を書いた分テストする）。

### 2. lib: Mutation 追加

```ts
| { op: "setPermissions"; filePath: string; defaultMode?: string | null; allow?: string[]; deny?: string[] }
```

- `undefined` のフィールドは「変更しない」。`defaultMode: null` は「キー削除」（removeJsonKey）
- プランナ: `setJsonValue(text, ["permissions", "allow"], allow)` 等をフィールドごとに適用。ファイル不在（settings.local.json が無い project 等）は `{}` から生成される（`setJsonValue` が null テキストを処理済み）
- `mutationReadPaths` 追加を忘れない

### 3. renderer

- 新規 `src/renderer/src/components/StringListEditor.tsx`: `{ label, items, onChange }`。KvEditor.tsx を参考に、1カラム input + ✕ボタン + `+ add`。並び替えは不要（実装しない）
- `SettingsView.tsx` の `SettingsEditor` に Permissions セクションを追加。初期値は `claudePermissions(entity.rawText)`（lib を renderer から直接 import — lib は純粋なので可）。ドラフトは useState、Save… で `requestPreview({ op: "setPermissions", ... })`
- **注意**: raw エディタと Permissions セクションは同じファイルの別ドラフト。Permissions を Apply すると raw の内容は古くなる — Apply 成功後は store が refresh するのでコンポーネントが再マウントされ raw も更新される（`key={selected.id}` 済み）。特別対応不要だが、挙動として理解しておく

### 4. settings.local.json が存在しない場合の導線（任意・推奨）

project スコープで settings.local.json エンティティが無い場合、SettingsView のリストに出てこない。今回は **スコープ外**（既存ファイルの編集のみ）。ただし手順書 07 の agent 追加時に「ファイル新規作成導線」として一般化する余地がある旨をコード コメントに残さない（コメント規約: 動機コメントは書かない）。

## テスト

- `tests/agents.test.ts`: `claudePermissions` — フル指定 / permissions 無し / allow が非配列 / 要素が非文字列 / defaultMode 非文字列
- `tests/mutations.test.ts`: setPermissions — allow のみ変更で deny/defaultMode/他キーがバイト不変 / defaultMode: null でキー削除 / ファイル不在から生成 / 空配列書込み / mutationReadPaths

## 検証

1. ゲート一式 green
2. 実機: `<repo>/.claude/settings.local.json`（例: parkour-cat）の allow に1行足す → 差分プレビューが配列1要素の追加のみ → Apply → 実ファイル確認 → 削除して戻す
3. `~/.claude/settings.json` の defaultMode をドロップダウンで変更 → プレビュー → **Apply せず Cancel**（実運用値を壊さない）

## 完了条件

- [ ] 検証 pass（2 は往復まで）
- [ ] lib 100%×4 維持
- [ ] codex の config.toml（settings, format: "toml"）に Permissions セクションが表示されないこと
- [ ] permissions 以外のキー（enabledPlugins 等）に差分が出ないこと
