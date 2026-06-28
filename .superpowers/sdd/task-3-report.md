# Task 3 実装レポート: ShiftFormModal に自動アサインチェックボックスを追加

## 実装概要

シフト新規作成時に「選択したスタッフを基本担当にも登録する」チェックボックスを ShiftFormModal に追加した。デフォルト ON、既存シフト編集時は非表示。

## 実施した変更

### src/components/shifts/ShiftFormModal.tsx

1. **MUI インポート追加**
   - `FormControlLabel, Checkbox` を `@/components/ui/mui` から追加

2. **State 追加**
   - `const [autoAssign, setAutoAssign] = useState(true);` を追加

3. **useEffect 修正**
   - else ブランチ（新規作成リセット部分）に `setAutoAssign(true);` を追加

4. **handleSave 修正**
   - payload に `autoAssign: !initialData ? autoAssign : false,` を追加
   - 新規作成時のみ state の値を使用、編集時は false に固定

5. **JSX 追加**
   - DateTimeField Stack の直後、initialData セクションの前に checkbox を追加
   - `!initialData` 条件で新規作成時のみ表示

## 検証

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

TypeScript 型チェック：エラーなし ✓

## コミット

`c9ab29f` feat(ui): add auto-assign checkbox to ShiftFormModal (方針A)

## 備考

- Task 2 で追加された `ShiftPayload.autoAssign?: boolean` を消費
- checkbox は新規作成（!initialData）時のみ表示される conditional rendering
- 既存シフト編集時は autoAssign が必ず false になるため、一括アサインは発動しない
