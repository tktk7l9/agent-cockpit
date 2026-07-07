# 08. レンダラーバンドル分割（CodeMirror 動的 import）

## 背景 / 目的

レンダラーの JS が単一チャンク約 1.77MB（React + zustand + CodeMirror 6 全部入り）。CodeMirror はエディタペインを開くまで不要なので遅延ロードし、初期チャンクを軽くする。デスクトップアプリなので実害は小さいが、起動体感と設計衛生の改善。

## 仕様

- `CodeEditor` コンポーネント（src/renderer/src/components/CodeEditor.tsx）を `React.lazy` + dynamic import 化する
- CodeMirror 系パッケージ（`codemirror` `@codemirror/*`）が **初期チャンクから消え**、専用チャンクに分離されること
- 読み込み中フォールバックは `.code-editor` と同寸の placeholder（レイアウトシフトさせない）
- 機能・見た目の変化なし（lang 切替・readOnly・onChange の挙動維持）

## 実装手順

1. `CodeEditor.tsx` はそのまま（default export を追加: `export default CodeEditor;`）
2. 新規 `src/renderer/src/components/LazyCodeEditor.tsx`:

```tsx
import { Suspense, lazy } from "react";
import type { EditorLang } from "./CodeEditor";
const Inner = lazy(() => import("./CodeEditor"));
interface Props { value: string; onChange?: (v: string) => void; lang: EditorLang; readOnly?: boolean; minHeight?: string }
export function LazyCodeEditor(props: Props) {
  return (
    <Suspense fallback={<div className="code-editor" style={{ minHeight: props.minHeight ?? "200px" }} />}>
      <Inner {...props} />
    </Suspense>
  );
}
```

- **注意**: `EditorLang` 型を `import type` で取ると型だけ静的参照になりチャンク分離は保たれる。値の静的 import（basicSetup 等）を LazyCodeEditor に書いたら分離が壊れる
3. 利用側 3 ファイル（MarkdownEntityView / SettingsView / InstructionsView）の `CodeEditor` import を `LazyCodeEditor` に置換
4. ビルドして確認: `npm run build` の出力で `out/renderer/assets/` に index チャンクと CodeMirror チャンクが分かれていること。`index-*.js` のサイズを before/after で記録

## テスト

lib 変更なし。typecheck / 既存テスト green のみ。

## 検証

1. `npm run build` → チャンク分離をビルドログで確認（index チャンクが目安 700KB 以下、CodeMirror チャンクが別ファイル）
2. `npx electron .` → 各ビュー（Skills/Settings/Instructions）でエディタが正常表示・編集できること。初回表示時に一瞬 placeholder が出るのは許容
3. 本番 CSP でチャンクの動的ロードが動くこと（`script-src 'self'` は同一オリジンの動的 import を許可するので通るはず — 実機で必ず確認）

## 完了条件

- [ ] 初期チャンクから codemirror が消えている（`npx source-map-explorer` 等は不要。ビルドログのファイルサイズと、`grep -c basicSetup out/renderer/assets/index-*.js` が 0 であることで足りる）
- [ ] 検証 3 点 pass
- [ ] レイアウトシフトなし（placeholder の minHeight 一致）
