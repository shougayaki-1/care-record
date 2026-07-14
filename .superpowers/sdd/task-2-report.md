# Task 2 Implementation Report: `offices` Server Actions

## What Was Implemented

Completed Task 2 as specified in the task-2-brief.md:
- **`src/app/actions/offices.ts`**: Implements 4 CRUD functions (`getOffices`, `createOffice`, `updateOffice`, `archiveOffice`) plus the `Office` type
- **`src/app/actions/offices.test.ts`**: 5 unit tests covering all success paths, validation, and permissions checks
- **`vitest.config.ts`**: Updated to support path alias resolution (`@/utils/*` imports in tests) via `resolve.alias`

## TDD Evidence

### Step 2: RED (Test Fails)
```
Error: Cannot find module '/src/app/actions/offices' imported from .../offices.test.ts
```
Before implementing `offices.ts`, the test file ran but couldn't import the module.

### Step 3 & 4: GREEN (Tests Pass)
After implementing `offices.ts` and fixing vitest path alias setup:
```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

All 5 tests passing:
1. ✅ getOffices: アーカイブ済みを除外して一覧取得する
2. ✅ createOffice: 単価が範囲外だとエラーになる
3. ✅ createOffice: 正常系で作成し監査ログを記録する
4. ✅ updateOffice: 権限チェックのうえ更新する
5. ✅ archiveOffice: archived_atを設定する

### Step 5: Typecheck
```
npm run typecheck
(no errors)
```

## Files Changed

1. **`src/app/actions/offices.ts`** (created)
   - 4 exported functions: getOffices, createOffice, updateOffice, archiveOffice
   - Office type with 7 fields
   - Validators for rate (0-10000 yen) and name (1-100 chars)
   - Error handling via sanitizeDbError
   - Audit logging for create/update/archive

2. **`src/app/actions/offices.test.ts`** (created)
   - Mocks for auth, audit, and errors modules
   - 5 test cases covering read perms, validation, create with audit, update, archive

3. **`vitest.config.ts`** (modified)
   - Added `resolve.alias` config for `@/` path imports

## Self-Review

✅ All 5 tests passing
✅ No typecheck errors
✅ Follows staffs.ts pattern exactly (sanitizeDbError, recordAuditEvent, assertOrgRole vs assertOrgPermission)
✅ Proper soft-delete via archived_at
✅ i18n-appropriate validation messages
✅ No scope creep - only the required files

## Commit

- SHA: 2ddebc6
- Message: "feat: add offices CRUD server actions"
