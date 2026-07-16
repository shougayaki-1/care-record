-- User-initiated shift mutations run under the caller's JWT and perform their
-- authorization and tenant checks in the same transaction as the writes.

CREATE OR REPLACE FUNCTION public.add_report_shift_link(
  p_org_id uuid, p_report_id uuid, p_shift_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_record_action_scope(p_org_id, auth.uid(), 'edit') = 'none' THEN RAISE EXCEPTION 'record edit permission required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'view') = 'none' THEN RAISE EXCEPTION 'shift view permission required'; END IF;
  IF NOT private.can_access_report(p_report_id) OR NOT private.can_access_shift(p_shift_id) THEN RAISE EXCEPTION 'resource access denied'; END IF;
  SELECT r.status INTO v_status FROM public.reports r JOIN public.clients c ON c.id = r.client_id
   WHERE r.id = p_report_id AND c.organization_id = p_org_id AND r.deleted_at IS NULL FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'record not found'; END IF;
  IF v_status NOT IN ('draft', 'remanded') THEN RAISE EXCEPTION 'approved records cannot be linked'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.id=p_shift_id AND s.organization_id=p_org_id AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'shift not found';
  END IF;
  INSERT INTO public.report_shifts(report_id, shift_id, is_primary) VALUES (p_report_id, p_shift_id, false)
  ON CONFLICT (report_id, shift_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.remove_report_shift_link(
  p_org_id uuid, p_report_id uuid, p_shift_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_primary boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_record_action_scope(p_org_id, auth.uid(), 'edit') = 'none' THEN RAISE EXCEPTION 'record edit permission required'; END IF;
  IF NOT private.can_access_report(p_report_id) OR NOT private.can_access_shift(p_shift_id) THEN RAISE EXCEPTION 'resource access denied'; END IF;
  SELECT rs.is_primary INTO v_primary FROM public.report_shifts rs
    JOIN public.reports r ON r.id=rs.report_id JOIN public.clients c ON c.id=r.client_id
    WHERE rs.report_id=p_report_id AND rs.shift_id=p_shift_id AND c.organization_id=p_org_id FOR UPDATE OF rs;
  IF v_primary THEN RAISE EXCEPTION 'primary shift cannot be removed'; END IF;
  DELETE FROM public.report_shifts WHERE report_id=p_report_id AND shift_id=p_shift_id AND is_primary=false;
END $$;

CREATE OR REPLACE FUNCTION public.replace_shift_segments(
  p_org_id uuid, p_shift_id uuid, p_segments jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item jsonb; new_segment_id uuid; staff_item jsonb; idx integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'edit') <> 'all' THEN RAISE EXCEPTION 'shift edit permission required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.id=p_shift_id AND s.organization_id=p_org_id AND s.deleted_at IS NULL FOR UPDATE) THEN
    RAISE EXCEPTION 'shift not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reports r WHERE r.shift_id=p_shift_id AND r.segment_id IS NOT NULL AND r.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'segments used by records cannot be edited';
  END IF;
  IF jsonb_typeof(COALESCE(p_segments, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'segments must be an array'; END IF;
  UPDATE public.shifts SET is_modified=true, google_sync_status='pending_upsert', google_sync_error=NULL,
    google_synced_at=NULL, updated_at=now() WHERE id=p_shift_id;
  DELETE FROM public.shift_segments WHERE shift_id=p_shift_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_segments, '[]'::jsonb)) LOOP
    IF (item->>'start_at')::timestamptz >= (item->>'end_at')::timestamptz THEN RAISE EXCEPTION 'segment end must be after start'; END IF;
    IF NULLIF(item->>'service_type_id','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.service_types st WHERE st.id=(item->>'service_type_id')::uuid AND st.organization_id=p_org_id AND st.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'service type outside organization'; END IF;
    INSERT INTO public.shift_segments(shift_id, service_type_id, start_at, end_at, sort_order)
      VALUES (p_shift_id, NULLIF(item->>'service_type_id','')::uuid, (item->>'start_at')::timestamptz,
        (item->>'end_at')::timestamptz, idx) RETURNING id INTO new_segment_id;
    FOR staff_item IN SELECT value FROM jsonb_array_elements(COALESCE(item->'staffs','[]'::jsonb)) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.staffs st WHERE st.id=(staff_item->>'staff_id')::uuid AND st.organization_id=p_org_id AND st.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'staff outside organization';
      END IF;
      INSERT INTO public.shift_segment_staffs(segment_id, staff_id, staff_role_id)
        VALUES (new_segment_id, (staff_item->>'staff_id')::uuid, NULLIF(staff_item->>'staff_role_id','')::uuid);
    END LOOP;
    idx := idx + 1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.delete_shift_segment_atomic(
  p_org_id uuid, p_segment_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_shift_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT ss.shift_id INTO v_shift_id FROM public.shift_segments ss JOIN public.shifts s ON s.id=ss.shift_id
    WHERE ss.id=p_segment_id AND s.organization_id=p_org_id AND s.deleted_at IS NULL FOR UPDATE OF ss;
  IF v_shift_id IS NULL THEN RAISE EXCEPTION 'segment not found'; END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'edit') <> 'all' THEN RAISE EXCEPTION 'shift edit permission required'; END IF;
  IF EXISTS (SELECT 1 FROM public.reports r WHERE r.segment_id=p_segment_id AND r.deleted_at IS NULL) THEN RAISE EXCEPTION 'segment used by record cannot be deleted'; END IF;
  DELETE FROM public.shift_segments WHERE id=p_segment_id;
  UPDATE public.shifts SET is_modified=true, google_sync_status='pending_upsert', google_sync_error=NULL,
    google_synced_at=NULL, updated_at=now() WHERE id=v_shift_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_shift_pattern_atomic(
  p_pattern_id uuid, p_org_id uuid, p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pattern_id uuid := p_pattern_id; v_action text; v_client_id uuid;
  segment_item jsonb; staff_item jsonb; new_segment_id uuid; idx integer := 0;
  v_staff_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  v_action := CASE WHEN p_pattern_id IS NULL THEN 'create' ELSE 'edit' END;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), v_action) <> 'all' THEN RAISE EXCEPTION 'shift permission required'; END IF;
  v_client_id := (p_payload->>'client_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id=v_client_id AND c.organization_id=p_org_id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'client outside organization';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->'segments','[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'segments must be an array'; END IF;

  IF p_pattern_id IS NULL THEN
    INSERT INTO public.shift_patterns(organization_id, client_id, title, start_time, end_time, rrule)
      VALUES (p_org_id, v_client_id, p_payload->>'title', (p_payload->>'start_time')::time,
        (p_payload->>'end_time')::time, p_payload->>'rrule') RETURNING id INTO v_pattern_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.shift_patterns sp WHERE sp.id=p_pattern_id AND sp.organization_id=p_org_id AND sp.deleted_at IS NULL FOR UPDATE) THEN
      RAISE EXCEPTION 'pattern not found';
    END IF;
    UPDATE public.shift_patterns SET client_id=v_client_id, title=p_payload->>'title',
      start_time=(p_payload->>'start_time')::time, end_time=(p_payload->>'end_time')::time,
      rrule=p_payload->>'rrule', updated_at=now() WHERE id=p_pattern_id;
  END IF;

  DELETE FROM public.shift_pattern_segments WHERE pattern_id=v_pattern_id;
  DELETE FROM public.shift_pattern_staffs WHERE pattern_id=v_pattern_id;
  FOR segment_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'segments','[]'::jsonb)) LOOP
    IF (segment_item->>'start_time')::time = (segment_item->>'end_time')::time THEN RAISE EXCEPTION 'segment start and end must differ'; END IF;
    IF NULLIF(segment_item->>'service_type_id','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.service_types st WHERE st.id=(segment_item->>'service_type_id')::uuid AND st.organization_id=p_org_id AND st.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'service type outside organization'; END IF;
    INSERT INTO public.shift_pattern_segments(pattern_id, service_type_id, start_time, end_time, sort_order)
      VALUES (v_pattern_id, NULLIF(segment_item->>'service_type_id','')::uuid,
        (segment_item->>'start_time')::time, (segment_item->>'end_time')::time, idx) RETURNING id INTO new_segment_id;
    FOR staff_item IN SELECT value FROM jsonb_array_elements(COALESCE(segment_item->'staffs','[]'::jsonb)) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.staffs st WHERE st.id=(staff_item->>'staff_id')::uuid AND st.organization_id=p_org_id AND st.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'staff outside organization';
      END IF;
      IF NULLIF(staff_item->>'staff_role_id','') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_roles sr WHERE sr.id=(staff_item->>'staff_role_id')::uuid AND sr.organization_id=p_org_id AND sr.deleted_at IS NULL
      ) THEN RAISE EXCEPTION 'staff role outside organization'; END IF;
      INSERT INTO public.shift_pattern_segment_staffs(segment_id, staff_id, staff_role_id)
        VALUES (new_segment_id, (staff_item->>'staff_id')::uuid, NULLIF(staff_item->>'staff_role_id','')::uuid);
      v_staff_ids := array_append(v_staff_ids, (staff_item->>'staff_id')::uuid);
    END LOOP;
    idx := idx + 1;
  END LOOP;
  INSERT INTO public.shift_pattern_staffs(pattern_id, staff_id)
    SELECT v_pattern_id, staff_id FROM unnest(v_staff_ids) staff_id GROUP BY staff_id;
  IF COALESCE((p_payload->>'auto_assign')::boolean, false) THEN
    INSERT INTO public.assignments(client_id, staff_id, helper_id)
      SELECT v_client_id, st.id, st.user_id FROM public.staffs st
      WHERE st.organization_id=p_org_id AND st.id=ANY(v_staff_ids) AND st.deleted_at IS NULL
      ON CONFLICT (client_id, staff_id) WHERE staff_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN v_pattern_id;
END $$;

REVOKE ALL ON FUNCTION public.add_report_shift_link(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_report_shift_link(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_shift_segments(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_shift_segment_atomic(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_shift_pattern_atomic(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_report_shift_link(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_report_shift_link(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_shift_segments(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_shift_segment_atomic(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_shift_pattern_atomic(uuid,uuid,jsonb) TO authenticated;
