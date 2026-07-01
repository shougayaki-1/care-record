## Task 2: `permission_alignment.sql` を Supabase DB に適用

**Files:**
- Execute: `supabase db push` or `supabase migration up`

- [ ] **Step 2.1: ローカル DB でマイグレーションを適用**

```bash
supabase db push --local
# または
supabase migration up
```

期待：`20260701000002_permission_alignment` が適用される

- [ ] **Step 2.2: ポリシー変更を確認（ローカル DB）**

```sql
-- Supabase Studio の SQL Editor または psql で実行
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN (
  'internal_work_records', 'shifts', 'clients', 'staffs',
  'organization_members', 'invitations', 'assignments',
  'organizations', 'shift_staffs', 'shift_patterns'
)
ORDER BY tablename, policyname;
```

確認内容：
- `Internal work visible to org members` が存在しない（DROP 済み）
- `Internal work visible by flexible role` が存在する
- `Admins can insert shifts` が存在しない（DROP 済み）
- `Shift creators insert shifts` が存在する

- [ ] **Step 2.3: `is_org_admin` 変更を確認**

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'is_org_admin'
  AND pronamespace = 'public'::regnamespace;
```

期待：`records` キーへの参照がなく、`role = 'owner'` チェックのみであること

- [ ] **Step 2.4: Commit**

```bash
# マイグレーション適用後、問題なければ
git add supabase/migrations/20260701000002_permission_alignment.sql
git commit -m "feat: apply permission_alignment migration to align RLS with flexible roles"
```

---

