# Task 3: 組織削除にowner必須チェックを追加

## Context
care-record は Next.js + Supabase のヘルスケア記録アプリ（branch: permission-design-cleanup）。
組織削除は `organizationDelete` 権限だけでは不可にし、owner であることも必須にする。

## Target Files
- `/Users/shoug/Documents/GitHub/care-record/src/app/actions/organization.ts`
- `/Users/shoug/Documents/GitHub/care-record/src/app/app/settings/page.tsx`

## Required Changes

### 1. src/app/actions/organization.ts の deleteOrganization

現在:
```typescript
export async function deleteOrganization(orgId: string) {
    // 権限チェック: 呼び出し元がこの事業所の owner であることをセッションから検証
    const { userId } = await assertOrgPermission(orgId, 'organizationDelete');
```

変更後（assertOrgPermission の返り値の isOwner を使い、2重DBアクセスを避ける）:
```typescript
export async function deleteOrganization(orgId: string) {
    // 権限チェック: owner かつ organizationDelete 権限が必要
    const { userId, isOwner } = await assertOrgPermission(orgId, 'organizationDelete');
    if (!isOwner) throw new Error('事業所の削除はオーナーのみ実行できます');
```

コメントも更新する。

### 2. src/app/app/settings/page.tsx の canDeleteOrganization

現在:
```typescript
const canDeleteOrganization = checkManagementPermission(currentOrg.effectivePermissions, 'organizationDelete');
```

変更後:
```typescript
const canDeleteOrganization = currentOrg.role === 'owner' && checkManagementPermission(currentOrg.effectivePermissions, 'organizationDelete');
```

（`currentOrg.role` は WorkspaceContext の Workspace 型に `role: OrganizationRole` として存在する）

## Verification Commands
```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | head -30
```

## Report File
`/Users/shoug/Documents/GitHub/care-record/.superpowers/sdd/task-3-report.md` に書いてください。

## Report Format
```
STATUS: DONE
COMMITS: <hash>
TESTS: <TypeScriptチェック結果>
CONCERNS: （あれば）
```
