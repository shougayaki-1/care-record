-- Security hardening: align direct report inserts with records.create scope and
-- remove unnecessary Data API privileges from service-role-only tables.

DROP POLICY IF EXISTS "Create reports" ON public.reports;
CREATE POLICY "Create reports" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = reports.client_id
        AND (
          private.get_member_record_action_scope(c.organization_id, auth.uid(), 'create') = 'all'
          OR (
            private.get_member_record_action_scope(c.organization_id, auth.uid(), 'create') = 'assigned'
            AND private.is_assigned_client_for_user(c.id, c.organization_id, auth.uid())
          )
        )
    )
  );

DROP POLICY IF EXISTS "Enable insert for staff" ON public.report_images;
CREATE POLICY "Enable insert for staff" ON public.report_images
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = report_images.report_id
        AND (
          private.get_member_record_action_scope(c.organization_id, auth.uid(), 'create') = 'all'
          OR (
            private.get_member_record_action_scope(c.organization_id, auth.uid(), 'create') = 'assigned'
            AND private.is_assigned_client_for_user(c.id, c.organization_id, auth.uid())
          )
        )
    )
  );

REVOKE ALL ON TABLE public.report_autosaves FROM anon, authenticated;
REVOKE ALL ON TABLE public.google_sync_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_run_items FROM anon, authenticated;

GRANT ALL ON TABLE public.report_autosaves TO service_role;
GRANT ALL ON TABLE public.google_sync_runs TO service_role;
GRANT ALL ON TABLE public.maintenance_runs TO service_role;
GRANT ALL ON TABLE public.maintenance_run_items TO service_role;
