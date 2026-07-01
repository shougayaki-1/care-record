## Task 3: report 系 RLS ポリシーの修正（防御の多層化）

**Background:** Server Actions がすべて `supabaseAdmin` 経由で `report_images` / `reports` / `report_values` を操作するため、現在の RLS 誤りはアプリ動作に直接影響しない。ただし、将来の直接クエリ経路やデバッグ用クエリの権限漏洩を防ぐため修正する。

**Files:**
- Create: `supabase/migrations/20260701000003_fix_report_policies.sql`

- [ ] **Step 3.1: 新規マイグレーションファイルを作成**

```sql
-- supabase/migrations/20260701000003_fix_report_policies.sql
-- Fix: report / report_values / report_images の UPDATE/DELETE/ALL ポリシーを
--      is_org_admin（owner-only）から get_member_record_action_scope ベースに置換する

-- ─── reports UPDATE ────────────────────────────────────────────────────────────
-- Before: helper_id = user OR is_org_admin
-- After:  helper_id = user OR records.edit = 'all' OR owner
DROP POLICY IF EXISTS "Update reports" ON "public"."reports";
CREATE POLICY "Update reports" ON "public"."reports"
  FOR UPDATE
  USING (
    helper_id = auth.uid()
    OR private.get_member_record_action_scope(
         (SELECT organization_id FROM public.clients c WHERE c.id = reports.client_id),
         auth.uid(),
         'edit'
       ) = 'all'
  )
  WITH CHECK (
    helper_id = auth.uid()
    OR private.get_member_record_action_scope(
         (SELECT organization_id FROM public.clients c WHERE c.id = reports.client_id),
         auth.uid(),
         'edit'
       ) = 'all'
  );

-- ─── reports DELETE ────────────────────────────────────────────────────────────
-- Before: is_org_admin のみ
-- After:  records.delete = 'all' OR owner
DROP POLICY IF EXISTS "Delete reports" ON "public"."reports";
CREATE POLICY "Delete reports" ON "public"."reports"
  FOR DELETE
  USING (
    private.get_member_record_action_scope(
      (SELECT organization_id FROM public.clients c WHERE c.id = reports.client_id),
      auth.uid(),
      'delete'
    ) = 'all'
  );

-- ─── report_values ALL ─────────────────────────────────────────────────────────
-- Before: helper_id = user OR is_org_admin
-- After:  helper_id = user OR records.edit = 'all'
DROP POLICY IF EXISTS "Manage report values" ON "public"."report_values";
CREATE POLICY "Manage report values" ON "public"."report_values"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = report_values.report_id
        AND (
          r.helper_id = auth.uid()
          OR private.get_member_record_action_scope(c.organization_id, auth.uid(), 'edit') = 'all'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = report_values.report_id
        AND (
          r.helper_id = auth.uid()
          OR private.get_member_record_action_scope(c.organization_id, auth.uid(), 'edit') = 'all'
        )
    )
  );

-- ─── report_images DELETE ──────────────────────────────────────────────────────
-- Before: helper_id = user OR is_org_admin
-- After:  helper_id = user OR records.delete = 'all'
DROP POLICY IF EXISTS "Delete report images" ON "public"."report_images";
CREATE POLICY "Delete report images" ON "public"."report_images"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = report_images.report_id
        AND (
          r.helper_id = auth.uid()
          OR private.get_member_record_action_scope(c.organization_id, auth.uid(), 'delete') = 'all'
        )
    )
  );
```

- [ ] **Step 3.2: ローカル DB に適用**

```bash
supabase db push --local
# または
supabase migration up
```

期待：`20260701000003_fix_report_policies` が適用される

- [ ] **Step 3.3: ポリシーを確認**

```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('reports', 'report_values', 'report_images')
ORDER BY tablename, policyname;
```

確認内容：
- `Update reports` が `get_member_record_action_scope` を使用する
- `Delete reports` が `get_member_record_action_scope` を使用する
- 古い `is_org_admin` への参照がこれらのポリシーに残っていない

- [ ] **Step 3.4: Commit**

```bash
git add supabase/migrations/20260701000003_fix_report_policies.sql
git commit -m "fix: replace is_org_admin in report/report_values/report_images RLS with flexible role scope checks"
```

---

