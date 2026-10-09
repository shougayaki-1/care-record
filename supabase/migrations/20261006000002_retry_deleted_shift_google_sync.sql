-- Issue #84: normal RLS continues to hide deleted shifts. Sync repair gets only
-- the identifiers needed to delete remote events, under the existing sync scope.
CREATE FUNCTION public.get_deleted_shift_sync_targets(p_org_id uuid, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.is_org_member(p_org_id) OR NOT (
    private.get_member_shift_action_scope(p_org_id,auth.uid(),'edit')='all'
    OR private.get_member_shift_action_scope(p_org_id,auth.uid(),'delete')='all'
  ) THEN RAISE EXCEPTION 'shift_sync_permission_required'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'google_event_id',s.google_event_id,
    'deleted_at',s.deleted_at,'google_sync_status',s.google_sync_status,'shift_staffs','[]'::jsonb) ORDER BY s.id),'[]'::jsonb)
    FROM (SELECT id,google_event_id,deleted_at,google_sync_status FROM public.shifts
      WHERE organization_id=p_org_id AND deleted_at IS NOT NULL AND google_sync_status IN ('pending_delete','failed')
      ORDER BY id LIMIT greatest(1,least(COALESCE(p_limit,5000),5000))) s);
END $$;
REVOKE ALL ON FUNCTION public.get_deleted_shift_sync_targets(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_deleted_shift_sync_targets(uuid,integer) TO authenticated;
