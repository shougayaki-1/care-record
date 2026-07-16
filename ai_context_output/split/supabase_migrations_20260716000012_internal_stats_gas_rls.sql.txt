-- Internal-work writes now use the caller JWT. The policy repeats authorization
-- at the database boundary and never trusts recorded_by or staff ownership input.
GRANT INSERT ON public.internal_work_records TO authenticated;

DROP POLICY IF EXISTS "Create internal work by flexible role" ON public.internal_work_records;
CREATE POLICY "Create internal work by flexible role" ON public.internal_work_records
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_session_active()
    AND recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.staffs s
      WHERE s.id = internal_work_records.staff_id
        AND s.organization_id = internal_work_records.organization_id
        AND s.deleted_at IS NULL
    )
    AND (
      private.get_member_internal_work_scope(organization_id, auth.uid(), 'create') = 'all'
      OR (
        private.get_member_internal_work_scope(organization_id, auth.uid(), 'create') = 'assigned'
        AND staff_id = private.get_actor_staff_id(organization_id, auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Report managers read internal work statistics" ON public.internal_work_records;
CREATE POLICY "Report managers read internal work statistics" ON public.internal_work_records
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND private.is_session_active()
    AND private.has_management_permission(organization_id, auth.uid(), 'reports')
  );
