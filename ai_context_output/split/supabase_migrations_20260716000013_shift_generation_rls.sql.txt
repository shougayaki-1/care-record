-- Atomic, caller-bound mutations used by shift generation and internal helpers.

CREATE OR REPLACE FUNCTION public.soft_delete_shifts_atomic(p_org_id uuid, p_shift_ids uuid[], p_reason text, p_retention_until timestamptz, p_sync_status text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id,auth.uid(),'delete') <> 'all' THEN RAISE EXCEPTION 'shift delete permission required'; END IF;
  IF cardinality(p_shift_ids) <> (SELECT count(*) FROM public.shifts s WHERE s.organization_id=p_org_id AND s.id=ANY(p_shift_ids) AND private.can_access_shift(s.id)) THEN RAISE EXCEPTION 'shift access denied'; END IF;
  UPDATE public.shifts SET deleted_at=now(),deleted_by=auth.uid(),deletion_reason=p_reason,retention_until=p_retention_until,
    google_sync_status=p_sync_status,google_sync_error=NULL,google_synced_at=CASE WHEN p_sync_status='synced' THEN now() ELSE NULL END
    WHERE organization_id=p_org_id AND id=ANY(p_shift_ids) AND deleted_at IS NULL;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.upsert_shift_assignments_atomic(p_org_id uuid,p_client_id uuid,p_staff_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() OR NOT private.can_access_client(p_client_id) THEN RAISE EXCEPTION 'access denied'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=p_client_id AND c.organization_id=p_org_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'client outside organization'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_staff_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.staffs s WHERE s.id=x AND s.organization_id=p_org_id AND s.deleted_at IS NULL)) THEN RAISE EXCEPTION 'staff outside organization'; END IF;
  INSERT INTO public.assignments(client_id,staff_id,helper_id)
    SELECT p_client_id,s.id,s.user_id FROM public.staffs s WHERE s.id=ANY(p_staff_ids) AND s.organization_id=p_org_id
    ON CONFLICT(client_id,staff_id) WHERE staff_id IS NOT NULL DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.replace_pattern_staffs_atomic(p_pattern_id uuid,p_staff_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM public.shift_patterns WHERE id=p_pattern_id AND deleted_at IS NULL FOR UPDATE;
  IF auth.uid() IS NULL OR NOT private.is_session_active() OR org IS NULL OR private.get_member_shift_action_scope(org,auth.uid(),'edit') <> 'all' OR NOT private.can_access_shift_pattern(p_pattern_id) THEN RAISE EXCEPTION 'access denied'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_staff_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.staffs s WHERE s.id=x AND s.organization_id=org AND s.deleted_at IS NULL)) THEN RAISE EXCEPTION 'staff outside organization'; END IF;
  DELETE FROM public.shift_pattern_staffs WHERE pattern_id=p_pattern_id;
  INSERT INTO public.shift_pattern_staffs(pattern_id,staff_id) SELECT p_pattern_id,x FROM unnest(p_staff_ids) x GROUP BY x;
END $$;

CREATE OR REPLACE FUNCTION public.replace_shift_staffs_atomic(p_shift_id uuid,p_staff_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM public.shifts WHERE id=p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF auth.uid() IS NULL OR NOT private.is_session_active() OR org IS NULL OR private.get_member_shift_action_scope(org,auth.uid(),'edit') <> 'all' OR NOT private.can_access_shift(p_shift_id) THEN RAISE EXCEPTION 'access denied'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_staff_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.staffs s WHERE s.id=x AND s.organization_id=org AND s.deleted_at IS NULL)) THEN RAISE EXCEPTION 'staff outside organization'; END IF;
  DELETE FROM public.shift_staffs WHERE shift_id=p_shift_id;
  INSERT INTO public.shift_staffs(shift_id,staff_id) SELECT p_shift_id,x FROM unnest(p_staff_ids) x GROUP BY x;
END $$;

CREATE OR REPLACE FUNCTION public.replace_pattern_segments_atomic(p_pattern_id uuid,p_segments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; item jsonb; staff jsonb; sid uuid; idx integer:=0;
BEGIN
  SELECT organization_id INTO org FROM public.shift_patterns WHERE id=p_pattern_id AND deleted_at IS NULL FOR UPDATE;
  IF auth.uid() IS NULL OR NOT private.is_session_active() OR org IS NULL OR private.get_member_shift_action_scope(org,auth.uid(),'edit') <> 'all' OR NOT private.can_access_shift_pattern(p_pattern_id) THEN RAISE EXCEPTION 'access denied'; END IF;
  IF jsonb_typeof(COALESCE(p_segments,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'segments must be array'; END IF;
  DELETE FROM public.shift_pattern_segments WHERE pattern_id=p_pattern_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_segments,'[]'::jsonb)) LOOP
    IF NULLIF(item->>'service_type_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.service_types x WHERE x.id=(item->>'service_type_id')::uuid AND x.organization_id=org AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'service type outside organization'; END IF;
    INSERT INTO public.shift_pattern_segments(pattern_id,service_type_id,start_time,end_time,sort_order) VALUES
      (p_pattern_id,NULLIF(item->>'service_type_id','')::uuid,(item->>'start_time')::time,(item->>'end_time')::time,idx) RETURNING id INTO sid;
    FOR staff IN SELECT value FROM jsonb_array_elements(COALESCE(item->'staffs','[]'::jsonb)) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.staffs x WHERE x.id=(staff->>'staff_id')::uuid AND x.organization_id=org AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'staff outside organization'; END IF;
      IF NULLIF(staff->>'staff_role_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.staff_roles x WHERE x.id=(staff->>'staff_role_id')::uuid AND x.organization_id=org AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'staff role outside organization'; END IF;
      INSERT INTO public.shift_pattern_segment_staffs(segment_id,staff_id,staff_role_id) VALUES(sid,(staff->>'staff_id')::uuid,NULLIF(staff->>'staff_role_id','')::uuid);
    END LOOP; idx:=idx+1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.replace_generated_shift_segments_atomic(p_shift_id uuid,p_segments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; item jsonb; staff jsonb; sid uuid; idx integer:=0;
BEGIN
  SELECT organization_id INTO org FROM public.shifts WHERE id=p_shift_id AND deleted_at IS NULL FOR UPDATE;
  IF auth.uid() IS NULL OR NOT private.is_session_active() OR org IS NULL OR private.get_member_shift_action_scope(org,auth.uid(),'edit') <> 'all' OR NOT private.can_access_shift(p_shift_id) THEN RAISE EXCEPTION 'access denied'; END IF;
  IF EXISTS(SELECT 1 FROM public.reports r WHERE r.shift_id=p_shift_id AND r.deleted_at IS NULL) THEN RETURN; END IF;
  DELETE FROM public.shift_segments WHERE shift_id=p_shift_id;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_segments,'[]'::jsonb)) LOOP
    IF NULLIF(item->>'service_type_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.service_types x WHERE x.id=(item->>'service_type_id')::uuid AND x.organization_id=org AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'service type outside organization'; END IF;
    IF NULLIF(item->>'source_pattern_segment_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.shift_pattern_segments ps JOIN public.shift_patterns p ON p.id=ps.pattern_id WHERE ps.id=(item->>'source_pattern_segment_id')::uuid AND p.organization_id=org) THEN RAISE EXCEPTION 'pattern segment outside organization'; END IF;
    INSERT INTO public.shift_segments(shift_id,source_pattern_segment_id,service_type_id,start_at,end_at,sort_order) VALUES
      (p_shift_id,NULLIF(item->>'source_pattern_segment_id','')::uuid,NULLIF(item->>'service_type_id','')::uuid,(item->>'start_at')::timestamptz,(item->>'end_at')::timestamptz,idx) RETURNING id INTO sid;
    FOR staff IN SELECT value FROM jsonb_array_elements(COALESCE(item->'staffs','[]'::jsonb)) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.staffs x WHERE x.id=(staff->>'staff_id')::uuid AND x.organization_id=org AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'staff outside organization'; END IF;
      IF NULLIF(staff->>'staff_role_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.staff_roles x WHERE x.id=(staff->>'staff_role_id')::uuid AND x.organization_id=org AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'staff role outside organization'; END IF;
      INSERT INTO public.shift_segment_staffs(segment_id,staff_id,staff_role_id) VALUES(sid,(staff->>'staff_id')::uuid,NULLIF(staff->>'staff_role_id','')::uuid);
    END LOOP; idx:=idx+1;
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
  IF EXISTS(SELECT 1 FROM public.reports r WHERE r.shift_id=sid AND r.deleted_at IS NULL) THEN RETURN sid; END IF;
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

REVOKE ALL ON FUNCTION public.soft_delete_shifts_atomic(uuid,uuid[],text,timestamptz,text), public.upsert_shift_assignments_atomic(uuid,uuid,uuid[]), public.replace_pattern_staffs_atomic(uuid,uuid[]), public.replace_shift_staffs_atomic(uuid,uuid[]), public.replace_pattern_segments_atomic(uuid,jsonb), public.replace_generated_shift_segments_atomic(uuid,jsonb), public.save_generated_shift_atomic(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_shifts_atomic(uuid,uuid[],text,timestamptz,text), public.upsert_shift_assignments_atomic(uuid,uuid,uuid[]), public.replace_pattern_staffs_atomic(uuid,uuid[]), public.replace_shift_staffs_atomic(uuid,uuid[]), public.replace_pattern_segments_atomic(uuid,jsonb), public.replace_generated_shift_segments_atomic(uuid,jsonb), public.save_generated_shift_atomic(uuid,uuid,jsonb) TO authenticated;
