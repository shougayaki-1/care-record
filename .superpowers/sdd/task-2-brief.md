# Task 2: 危険ロールのowner限定バリデーション追加

## Context
care-record は Next.js + Supabase のヘルスケア記録アプリ（branch: permission-design-cleanup）。
業務ロール付与において、強力な管理権限を含む「危険ロール」の付与は owner のみが行えるようにする。

## 危険ロールの定義
以下のいずれかを `management` で持つ `RolePermissions` が設定されたロールを「危険ロール」と呼ぶ:
- `management.accounts`
- `management.roles`
- `management.organizationDelete`
- `management.ownerTransfer`

## Target Files
- `/Users/shoug/Documents/GitHub/care-record/src/app/actions/accounts.ts`
- `/Users/shoug/Documents/GitHub/care-record/src/app/app/accounts/page.tsx`

## Required Changes

### 1. src/app/actions/accounts.ts

#### ヘルパー関数を追加
ファイルの先頭付近（インポートの後）に以下を追加する:
```typescript
import type { RolePermissions } from '@/utils/permissions';

function isDangerousPermissions(permissions: RolePermissions): boolean {
  const { accounts, roles, organizationDelete, ownerTransfer } = permissions.management;
  return accounts || roles || organizationDelete || ownerTransfer;
}
```
（RolePermissions は既にインポートされていないかもしれないので確認すること）

#### assertDangerousRoleOwnerCheck ヘルパー（任意）
roleIds から DB で permissions を引き、危険ロールがあれば isOwner を検証する共通処理:
```typescript
async function assertDangerousRoleOwnerCheck(
  orgId: string,
  roleIds: string[],
  isOwner: boolean,
): Promise<void> {
  if (roleIds.length === 0) return;
  const { data: roles } = await supabaseAdmin
    .from('organization_roles')
    .select('id, permissions')
    .eq('organization_id', orgId)
    .in('id', roleIds);
  const hasDangerous = (roles ?? []).some(r => isDangerousPermissions(r.permissions as RolePermissions));
  if (hasDangerous && !isOwner) {
    throw new Error('危険な権限を含むロールの付与はオーナーのみ実行できます');
  }
}
```

#### createInvitation の変更
現在のコード:
```typescript
export async function createInvitation(orgId: string, params: { targetName: string; roleIds?: string[]; staffId?: string | null }) {
    const { userId } = await assertOrgPermission(orgId, 'accounts');
```
変更後:
```typescript
export async function createInvitation(orgId: string, params: { targetName: string; roleIds?: string[]; staffId?: string | null }) {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'accounts');
    await assertDangerousRoleOwnerCheck(orgId, params.roleIds ?? [], isOwner);
```

#### updateMemberRoles の変更
現在のコード:
```typescript
export async function updateMemberRoles(orgId: string, targetUserId: string, roleIds: string[]): Promise<void> {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'accounts');
    void isOwner; // used for audit; permission already checked
```
変更後:
```typescript
export async function updateMemberRoles(orgId: string, targetUserId: string, roleIds: string[]): Promise<void> {
    const { userId, isOwner } = await assertOrgPermission(orgId, 'accounts');
    await assertDangerousRoleOwnerCheck(orgId, roleIds, isOwner);
```
（`void isOwner;` の行は削除する）

### 2. src/app/actions/accounts.ts の getOrgRoles に is_dangerous を追加
現在:
```typescript
export async function getOrgRoles(orgId: string): Promise<{ id: string; name: string; color: string | null; is_preset: boolean }[]>
```
変更後: permissions も取得し、is_dangerous を計算して返す:
```typescript
export async function getOrgRoles(orgId: string): Promise<{ id: string; name: string; color: string | null; is_preset: boolean; is_dangerous: boolean }[]>
```
実装:
```typescript
const { data, error: rolesError } = await supabaseAdmin
    .from('organization_roles')
    .select('id, name, color, is_preset, permissions')
    .eq('organization_id', orgId)
    .order('is_preset', { ascending: false });
if (rolesError) throw new Error('ロール一覧を取得できませんでした');
return (data ?? []).map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    is_preset: r.is_preset,
    is_dangerous: isDangerousPermissions(r.permissions as RolePermissions),
}));
```

### 3. src/app/app/accounts/page.tsx の UI変更

#### availableRoles の型を更新
```typescript
const [availableRoles, setAvailableRoles] = useState<{ id: string; name: string; color: string | null; is_preset: boolean; is_dangerous: boolean }[]>([]);
```

#### isOwner の取得
```typescript
const isOwner = currentOrg?.role === 'owner';
```

#### 招待ダイアログのロール選択 (付与するロール)
is_dangerous かつ非owner の場合は disabled にする:
```tsx
{availableRoles.map((role) => {
  const selected = selectedRoleIds.includes(role.id);
  const locked = role.is_dangerous && !isOwner;
  return (
    <Chip
      key={role.id}
      label={role.name}
      onClick={() => {
        if (locked) return;
        if (selected) setSelectedRoleIds(prev => prev.filter(id => id !== role.id));
        else setSelectedRoleIds(prev => [...prev, role.id]);
      }}
      variant={selected ? 'filled' : 'outlined'}
      sx={{
        cursor: locked ? 'not-allowed' : 'pointer',
        opacity: locked ? 0.4 : 1,
        borderColor: role.color ?? undefined,
        color: selected ? '#fff' : (role.color ?? undefined),
        bgcolor: selected ? (role.color ?? undefined) : undefined,
      }}
    />
  );
})}
```

#### 権限変更ダイアログのロール選択 (割り当てるロール)
同様に locked 判定を追加する（同じパターン）。

## Verification Commands
```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | head -60
```

## Report File
`/Users/shoug/Documents/GitHub/care-record/.superpowers/sdd/task-2-report.md` に書いてください。

## Report Format
```
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
COMMITS: <hash>
TESTS: <TypeScriptチェック結果>
CONCERNS: （あれば）
```
