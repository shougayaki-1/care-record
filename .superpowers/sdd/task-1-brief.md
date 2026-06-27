# Task 1: shifts.approveを型・プリセット・UIから削除する

## Context
care-record は Next.js + Supabase のヘルスケア記録アプリ（branch: permission-design-cleanup）。
権限設計整理の一環として、シフトに「承認」アクションは不要なため型・プリセット・UIから削除する。
DB内の既存JSON（`shifts.approve`キー）はmigrationで削除しない（アプリ側で無視するだけでOK）。

## Target Files
- `/Users/shoug/Documents/GitHub/care-record/src/utils/permissions.ts`
- `/Users/shoug/Documents/GitHub/care-record/src/components/roles/RolePermissionsMatrix.tsx`
- `/Users/shoug/Documents/GitHub/care-record/src/utils/permissions.test.ts`

## Required Changes

### 1. src/utils/permissions.ts
- `ShiftAction` 型を `'view' | 'create' | 'edit' | 'delete'` に変更（`'approve'` を削除）
- `EMPTY_PERMISSIONS.shifts` から `approve: 'none'` を削除
- `FULL_PERMISSIONS.shifts` から `approve: 'all'` を削除
- `PRESET_MANAGER_PERMISSIONS.shifts` から `approve: 'all'` を削除
- `PRESET_STAFF_PERMISSIONS.shifts` から `approve: 'none'` を削除

### 2. src/components/roles/RolePermissionsMatrix.tsx
現在 `RECORD_ROWS`（5行: view/create/edit/delete/approve）を records と shifts の両方に流用している。
シフトには「承認」列が不要なので分離する。

推奨実装方針:
- `RECORD_ROWS` はそのまま records 用（5行）として使う
- `SHIFT_ROWS` を新たに定義し、承認なし4行にする
- テーブルヘッダーは RECORD_ROWS の5列のまま維持し、shifts行の承認セルは空セル（`<TableCell />`）にする
- モバイル Stack 表示でも同様に shifts は SHIFT_ROWS を使う
- `type ShiftAction = keyof RolePermissions['shifts']` は型が自動的に更新されるのでそのままでOK

### 3. src/utils/permissions.test.ts
現在のテスト内容:
- `checkShiftPermission(FULL_PERMISSIONS, 'edit', false)` → そのまま維持
- `checkShiftPermission(PRESET_STAFF_PERMISSIONS, 'view', ...)` → そのまま維持
- `checkShiftPermission(PRESET_STAFF_PERMISSIONS, 'create', ...)` → そのまま維持
- `checkShiftPermission(PRESET_STAFF_PERMISSIONS, 'delete', ...)` → そのまま維持
- shifts に 'approve' を使っているテストがあれば削除
- FULL_PERMISSIONS で shifts.approve を直接参照するテストがあれば修正

## Verification Commands
```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | head -60
npx vitest run src/utils/permissions.test.ts 2>&1
```

## Report File
`/Users/shoug/Documents/GitHub/care-record/.superpowers/sdd/task-1-report.md` に書いてください。

## Report Format
1行目: STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
2行目: COMMITS: <hash>
3行目: TESTS: <テスト結果サマリー>
4行目以降: CONCERNS: （あれば）
