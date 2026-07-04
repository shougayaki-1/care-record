# フロントエンドルール

- UI規約の正本は `docs/ui-system.md`。例外リストは `docs/ui-exceptions.md`。この2つに従う。
- 新規UIは `src/components/ui` のエクスポートを最優先で使う。色はテーマトークンのみ
  （リテラルカラー禁止）。
- MUI v7: `slotProps` を使う。`InputProps` / `InputLabelProps` 等の非推奨APIは新規コードに書かない。
- 再利用コンポーネントを追加・変更したら、対応するStorybookストーリー
  （`*.stories.tsx`）も更新する。
- React 19 + React Compiler が有効。手動 `useMemo`/`useCallback` の追加は原則不要。
