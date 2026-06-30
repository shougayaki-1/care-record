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

-- ─── GRANT missing from permission_alignment.sql ───────────────────────────────
GRANT EXECUTE ON FUNCTION "private"."can_access_client"("uuid") TO "authenticated";
