## Task 1: `permission_alignment.sql` の内容検証

**Files:**
- Read: `supabase/migrations/20260701000002_permission_alignment.sql`

検証ポイント（全て確認済みならチェック）：

- [ ] `private.has_management_permission` が owner と role JSONB の `management.*` 両方をカバーする
- [ ] `private.can_access_client` が `records.view = 'all'` のユーザーと assignment ユーザー双方をカバーする
- [ ] `private.get_member_internal_work_scope` が `'all'` / `'assigned'` / `'none'` を正しく返す
- [ ] `Internal work visible by flexible role` ポリシーが古い `Internal work visible to org members` を DROP する
- [ ] shifts 系ポリシーが `get_member_shift_action_scope` を使用する
- [ ] clients / staffs / assignments / form_templates / organization_members / invitations / organizations の各ポリシーが `has_management_permission` を使用する
- [ ] GRANT 文が `private.*` 関数に `authenticated` ロールへの EXECUTE を付与している

**Step 1.1: `permission_alignment.sql` の確認**

```bash
cat supabase/migrations/20260701000002_permission_alignment.sql
```

期待：上記チェック項目がすべて含まれていること

- [ ] **Step 1.2: `is_org_admin` が owner-only に戻っていることを確認**

`permission_alignment.sql` 内の `is_org_admin` 定義が以下と一致すること：

```sql
CREATE OR REPLACE FUNCTION "public"."is_org_admin"("_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = _org_id
      AND om.user_id = auth.uid()
      AND om.role = 'owner'
  );
$$;
```

- [ ] **Step 1.3: `can_access_client` が `management.reports` もカバーすることを確認**

`can_access_client` 内に `has_management_permission(..., 'reports')` 呼び出しがあること

---

