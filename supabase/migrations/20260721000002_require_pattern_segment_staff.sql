-- 各シフトひな形区間には最低1人の担当スタッフを必須化する（defense-in-depth）。
-- UI側（ShiftPatternModal）のバリデーションのみでは、save_shift_pattern_atomic を
-- 直接呼び出す経路で担当スタッフ0人の区間を保存できてしまい、そこから生成される
-- 月次シフトの担当者が空欄になる不具合の原因となっていた。

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
    IF jsonb_array_length(COALESCE(segment_item->'staffs','[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'segment requires at least one staff'; END IF;
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
