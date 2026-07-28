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
      IF NULLIF(staff_item->>'staff_role_id','') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_roles sr WHERE sr.id=(staff_item->>'staff_role_id')::uuid AND sr.organization_id=p_org_id AND sr.deleted_at IS NULL
      ) THEN RAISE EXCEPTION 'staff role outside organization'; END IF;
      INSERT INTO public.shift_segment_staffs(segment_id, staff_id, staff_role_id)
        VALUES (new_segment_id, (staff_item->>'staff_id')::uuid, NULLIF(staff_item->>'staff_role_id','')::uuid);
    END LOOP;
    idx := idx + 1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.save_generated_shift_atomic(p_shift_id uuid,p_org_id uuid,p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid:=p_shift_id; item jsonb; staff jsonb; seg_id uuid; idx integer:=0; action text;
BEGIN
  action:=CASE WHEN p_shift_id IS NULL THEN 'create' ELSE 'edit' END;
  IF auth.uid() IS NULL OR NOT private.is_session_active() OR private.get_member_shift_action_scope(p_org_id,auth.uid(),action) <> 'all' THEN RAISE EXCEPTION 'access denied'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=(p_payload->>'client_id')::uuid AND c.organization_id=p_org_id AND c.deleted_at IS NULL AND private.can_access_client(c.id)) THEN RAISE EXCEPTION 'client access denied'; END IF;
  IF p_shift_id IS NULL THEN
    INSERT INTO public.shifts(organization_id,client_id,title,start_at,end_at,status,pattern_id,is_modified,google_sync_status)
      VALUES(p_org_id,(p_payload->>'client_id')::uuid,p_payload->>'title',(p_payload->>'start_at')::timestamptz,(p_payload->>'end_at')::timestamptz,p_payload->>'status',NULLIF(p_payload->>'pattern_id','')::uuid,false,'pending_upsert') RETURNING id INTO sid;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.shifts s WHERE s.id=sid AND s.organization_id=p_org_id AND s.deleted_at IS NULL AND private.can_access_shift(s.id) FOR UPDATE) THEN RAISE EXCEPTION 'shift access denied'; END IF;
    IF EXISTS(SELECT 1 FROM public.shifts s WHERE s.id=sid AND s.is_modified) THEN RETURN sid; END IF;
    UPDATE public.shifts SET client_id=(p_payload->>'client_id')::uuid,title=p_payload->>'title',start_at=(p_payload->>'start_at')::timestamptz,
      end_at=(p_payload->>'end_at')::timestamptz,status=p_payload->>'status',is_modified=false,updated_at=now(),google_sync_status='pending_upsert',google_sync_error=NULL,google_synced_at=NULL WHERE id=sid;
  END IF;
  IF EXISTS(SELECT 1 FROM public.reports r WHERE r.shift_id=sid AND r.segment_id IS NOT NULL AND r.deleted_at IS NULL) THEN RETURN sid; END IF;
  DELETE FROM public.shift_segments WHERE shift_id=sid;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'segments','[]'::jsonb)) LOOP
    IF NULLIF(item->>'service_type_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.service_types x WHERE x.id=(item->>'service_type_id')::uuid AND x.organization_id=p_org_id AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'service type outside organization'; END IF;
    IF NULLIF(item->>'source_pattern_segment_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.shift_pattern_segments ps JOIN public.shift_patterns p ON p.id=ps.pattern_id WHERE ps.id=(item->>'source_pattern_segment_id')::uuid AND p.organization_id=p_org_id) THEN RAISE EXCEPTION 'pattern segment outside organization'; END IF;
    INSERT INTO public.shift_segments(shift_id,source_pattern_segment_id,service_type_id,start_at,end_at,sort_order) VALUES
      (sid,NULLIF(item->>'source_pattern_segment_id','')::uuid,NULLIF(item->>'service_type_id','')::uuid,(item->>'start_at')::timestamptz,(item->>'end_at')::timestamptz,idx) RETURNING id INTO seg_id;
    FOR staff IN SELECT value FROM jsonb_array_elements(COALESCE(item->'staffs','[]'::jsonb)) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.staffs x WHERE x.id=(staff->>'staff_id')::uuid AND x.organization_id=p_org_id AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'staff outside organization'; END IF;
      IF NULLIF(staff->>'staff_role_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.staff_roles x WHERE x.id=(staff->>'staff_role_id')::uuid AND x.organization_id=p_org_id AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'staff role outside organization'; END IF;
      INSERT INTO public.shift_segment_staffs(segment_id,staff_id,staff_role_id) VALUES(seg_id,(staff->>'staff_id')::uuid,NULLIF(staff->>'staff_role_id','')::uuid);
    END LOOP; idx:=idx+1;
  END LOOP;
  RETURN sid;
END $$;

CREATE OR REPLACE FUNCTION public.create_shift_with_segments_atomic(p_org_id uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sid uuid; item jsonb; staff jsonb; seg_id uuid; idx integer := 0;
  v_client_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'create') <> 'all' THEN RAISE EXCEPTION 'shift create permission required'; END IF;
  v_client_id := (p_payload->>'client_id')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id=v_client_id AND c.organization_id=p_org_id AND c.deleted_at IS NULL
      AND private.can_access_client(c.id)
  ) THEN RAISE EXCEPTION 'client access denied'; END IF;
  IF jsonb_typeof(COALESCE(p_payload->'segments','[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'segments must be an array'; END IF;

  INSERT INTO public.shifts(
    organization_id, client_id, title, start_at, end_at, status, pattern_id,
    is_modified, google_sync_status, google_sync_error, google_synced_at
  ) VALUES (
    p_org_id, v_client_id, p_payload->>'title', (p_payload->>'start_at')::timestamptz,
    (p_payload->>'end_at')::timestamptz, COALESCE(NULLIF(p_payload->>'status',''), 'published'),
    NULLIF(p_payload->>'pattern_id','')::uuid, COALESCE((p_payload->>'is_modified')::boolean, false),
    'pending_upsert', NULL, NULL
  ) RETURNING id INTO sid;

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'segments','[]'::jsonb)) LOOP
    IF (item->>'start_at')::timestamptz >= (item->>'end_at')::timestamptz THEN RAISE EXCEPTION 'segment end must be after start'; END IF;
    IF NULLIF(item->>'service_type_id','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.service_types x WHERE x.id=(item->>'service_type_id')::uuid AND x.organization_id=p_org_id AND x.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'service type outside organization'; END IF;
    INSERT INTO public.shift_segments(shift_id,service_type_id,start_at,end_at,sort_order) VALUES
      (sid,NULLIF(item->>'service_type_id','')::uuid,(item->>'start_at')::timestamptz,(item->>'end_at')::timestamptz,idx)
      RETURNING id INTO seg_id;
    FOR staff IN SELECT value FROM jsonb_array_elements(COALESCE(item->'staffs','[]'::jsonb)) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.staffs x WHERE x.id=(staff->>'staff_id')::uuid AND x.organization_id=p_org_id AND x.deleted_at IS NULL
      ) THEN RAISE EXCEPTION 'staff outside organization'; END IF;
      IF NULLIF(staff->>'staff_role_id','') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.staff_roles x WHERE x.id=(staff->>'staff_role_id')::uuid AND x.organization_id=p_org_id AND x.deleted_at IS NULL
      ) THEN RAISE EXCEPTION 'staff role outside organization'; END IF;
      INSERT INTO public.shift_segment_staffs(segment_id,staff_id,staff_role_id)
        VALUES(seg_id,(staff->>'staff_id')::uuid,NULLIF(staff->>'staff_role_id','')::uuid);
    END LOOP;
    idx := idx + 1;
  END LOOP;
  RETURN sid;
END $$;

REVOKE ALL ON FUNCTION public.replace_shift_segments(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_generated_shift_atomic(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_shift_with_segments_atomic(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_shift_segments(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_generated_shift_atomic(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_shift_with_segments_atomic(uuid,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
