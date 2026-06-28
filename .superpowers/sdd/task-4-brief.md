### Task 4: WorkspaceContext の 3RTT → 2RTT 削減
**ファイル:** `src/context/WorkspaceContext.tsx`

**現状:** organization_members + profiles を並列取得後、organization_member_roles を直列で追加取得。

**修正:** `organization_members` クエリに `organization_member_roles` を JOIN で含める:
```typescript
supabase
  .from('organization_members')
  .select(`
    organization_id, role,
    organizations!inner (id, name),
    organization_member_roles (organization_roles (permissions))
  `)
  .eq('user_id', session.user.id)
```

`organization_member_roles` テーブルは `FK (organization_id, user_id) → organization_members` を持つので PostgREST のネスト結合が使える（`202606250001_flexible_roles.sql` 確認済み）。

取得した `member.organization_member_roles` から `permissions` を展開してそのまま `mergePermissions()` に渡す。独立した `roleLinksByOrg` の Map 構築ロジックをインライン化する。

`Promise.all` の2本（members + profiles）は維持。**organization_member_roles の独立クエリを削除**。

**効果:** ワークスペース読み込みで 3RTT → 2RTT

---

