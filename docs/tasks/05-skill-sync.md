# 05. Skill の Claude⇄Cursor 比較・同期

## 背景 / 目的

同名 Skill が複数エージェントに存在し得る（実例: このマシンでは `publish-check` と `react-doctor` が `~/.claude/skills` と `~/.cursor/skills` の両方にあり、内容が乖離しうる）。同名 Skill の内容差分を検出・表示し、片方向コピーで同期できるようにする。このアプリにしかできない差別化機能。

## 仕様

### 検出
- 対象: `kind === "skill"` かつ `readOnly === false` のエンティティ（`skills-cursor` の built-in は除外）
- 同名 = `name`（frontmatter の name ではなくディレクトリ名由来の `tag.name` … 実装上は entityId の末尾。既存 SkillEntity では `name` に frontmatter 優先の値が入っている点に注意 — **比較キーはファイルパス由来のディレクトリ名** とする。`fileBaseName` 相当のロジックを lib に置く）
- 内容一致の定義: 「frontmatter の name/description/version が一致」かつ「body が完全一致」。frontmatterExtras の差は無視（エージェント固有キーがあり得るため）— この定義は UI に明記する

### UI
- SkillsView のリスト行: 同名 skill が他エージェントに存在する場合、`≡ synced`（一致・muted）または `≠ differs`（差分あり・`--warn` 色）のタグを表示
- エディタペインに **Compare セクション**: 相手エンティティのセレクタ（同名が2つ以上あるとき）+ 差分表示（`buildDiffLines` を renderer で直接利用 — lib は純粋なので import 可）+ 2ボタン:
  - `Copy to <相手agent>…` — このエンティティの内容で相手を上書き（upsertSkill mutation・通常の差分プレビュー経由）
  - `Copy from <相手agent>…` — 逆方向
- コピーは常に「name/description/version/body の全上書き」。相手側の frontmatterExtras は upsertSkill の既存挙動（updateFrontmatter = 対象キー以外保持）により **生存する**

### スコープ
- user スコープ同士のみ対象（project スコープの skill は除外 — 混ぜると UI が複雑になりすぎる）
- Codex の `~/.codex/skills` も対象に含める（現在空だが形式は同じ）

## 実装手順

### 1. lib: ペアリングと比較（新規 `src/lib/skill-sync.ts`）

```ts
import type { SkillEntity } from "./model/types";

export interface SkillCounterpart { entity: SkillEntity; identical: boolean }

/** ファイルパスからディレクトリ名（= 同期キー）を得る: "<dir>/<key>/SKILL.md" */
export function skillKey(filePath: string): string;

/** 同一 user スコープ・readOnly でない skill を key でグループ化 */
export function groupSkillsByKey(skills: SkillEntity[]): Map<string, SkillEntity[]>;

/** 比較: name/description/version/body の一致判定（frontmatterExtras は無視） */
export function skillsIdentical(a: SkillEntity, b: SkillEntity): boolean;

/** ある skill から見た他エージェントの同名 skill 一覧 */
export function counterpartsOf(skill: SkillEntity, all: SkillEntity[]): SkillCounterpart[];
```

- version は `undefined` と `""` を同値扱いにする（片方に version 行が無いだけで differs にしない）
- body は完全一致（trim しない — 末尾改行差も差分として扱い、diff 表示で見える）

### 2. renderer: SkillsView（MarkdownEntityView）拡張

`MarkdownEntityView.tsx` は skill/subagent/command 共用なので、Compare セクションは `kind === "skill"` のときのみ描画する専用子コンポーネント `SkillCompare` を新設（`src/renderer/src/components/SkillCompare.tsx`）:

- props: `{ entity: SkillEntity; all: SkillEntity[]; home: string }`
- `counterpartsOf` で相手を列挙。0件なら「No counterpart in other agents」+ **`Copy to…` セレクタ**（未所持エージェントへの新規コピー: dirOptions 相当のリストから選ぶ → upsertSkill で新規作成）
- 差分表示: `buildDiffLines(counterpart側の再構成テキスト, 自分側の再構成テキスト)` … 再構成は `buildFrontmatterFile({name, description, version}, body)` を両側に使い正規化して比較（生ファイル同士だと extras 差でノイズが出る）
- コピー実行: `requestPreview({ op: "upsertSkill", dir: 相手のskillsディレクトリ, name: key, prevName: key, description: source.description, version: source.version, body: source.body })`
  - 相手ディレクトリ: 相手エンティティがあれば `filePath` から導出（`/<key>/SKILL.md` を除去）。新規なら `${home}/.claude/skills` | `${home}/.codex/skills` | `${home}/.cursor/skills`
- リスト行タグ: `MarkdownEntityView` のリスト描画で skill のときだけ `counterpartsOf` を引いて `≡/≠` タグを付ける（`useMemo` でエンティティ配列から一括計算し Map 化。行ごとに O(n²) にしない）

## テスト

`tests/skill-sync.test.ts` 新規（全関数・全分岐）:
- `skillKey`: 通常パス / ネストの深いパス
- `groupSkillsByKey`: user のみ・readOnly 除外・project 除外
- `skillsIdentical`: 完全一致 / body 差 / description 差 / version undefined vs "" は一致 / version 実差
- `counterpartsOf`: 自分自身を含まない / identical フラグ / 0件

fixture は合成 SkillEntity を手書き（`entityId` を使い整合させる）。

## 検証（実機）

1. ゲート一式 green
2. `npx electron .` → Skills → `publish-check`（Claude）に `≠` または `≡` タグが付き、Compare セクションに Cursor 側との差分が出ること
3. **安全な往復テスト**: `~/.cursor/skills/react-doctor` を対象に、Claude→Cursor へ Copy → 差分プレビュー確認 → Apply → Cursor 側ファイルを cat で確認 → Backups から復元して原状回復
4. 相手がいない skill（例: keihi）で「No counterpart」+ Copy to… が出ること（Apply はしない）

## 完了条件

- [ ] 検証 pass（3 の原状回復まで）
- [ ] lib 100%×4 維持（skill-sync.ts 全分岐）
- [ ] built-in（skills-cursor）が比較・コピー対象に一切出ないこと
- [ ] コピーで相手側の frontmatterExtras が消えないこと（テストで担保: 既存ファイルに extra キーを持つフィクスチャ）
