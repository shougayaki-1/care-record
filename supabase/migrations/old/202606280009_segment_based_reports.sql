-- Treat shift_segments as the unit for service records while keeping the
-- legacy report_shifts link to the parent shift.

CREATE UNIQUE INDEX IF NOT EXISTS reports_active_segment_unique_idx
  ON public.reports (segment_id)
  WHERE segment_id IS NOT NULL AND deleted_at IS NULL;

DROP FUNCTION IF EXISTS public.save_report_atomic(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.save_report_atomic(
  p_organization_id uuid,
  p_report_id uuid,
  p_client_id uuid,
  p_shift_id uuid,
  p_segment_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_status text,
  p_values jsonb,
  p_session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  target uuid := p_report_id;
  previous_status text;
  existing_helper uuid;
  existing_shift_id uuid;
  existing_segment_id uuid;
  effective_shift_id uuid := p_shift_id;
  effective_segment_id uuid := p_segment_id;
  segment_shift_id uuid;
  actor_staff_id uuid;
  create_scope text;
  edit_scope text;
  approve_scope text;
  required_scope text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_end_at <= p_start_at THEN RAISE EXCEPTION 'invalid_period'; END IF;
  IF p_status NOT IN ('draft', 'pending', 'approved', 'remanded') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF octet_length(p_values::text) > 1000000 THEN RAISE EXCEPTION 'values_too_large'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = p_organization_id
       AND om.user_id = actor
  ) THEN RAISE EXCEPTION 'access_denied'; END IF;

  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'create') INTO create_scope;
  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'edit') INTO edit_scope;
  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'approve') INTO approve_scope;

  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id AND c.organization_id = p_organization_id AND c.deleted_at IS NULL)
    THEN RAISE EXCEPTION 'client_not_found'; END IF;

  SELECT st.id INTO actor_staff_id
    FROM public.staffs st
   WHERE st.organization_id = p_organization_id
     AND st.user_id = actor
     AND st.deleted_at IS NULL
   ORDER BY st.sort_order NULLS LAST, st.name
   LIMIT 1;

  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
     WHERE s.id = p_shift_id
       AND s.organization_id = p_organization_id
       AND s.client_id = p_client_id
       AND s.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'shift_not_found'; END IF;

  IF p_segment_id IS NOT NULL THEN
    SELECT ss.shift_id INTO segment_shift_id
      FROM public.shift_segments ss
      JOIN public.shifts s ON s.id = ss.shift_id
     WHERE ss.id = p_segment_id
       AND s.organization_id = p_organization_id
       AND s.client_id = p_client_id
       AND s.deleted_at IS NULL;
    IF segment_shift_id IS NULL THEN RAISE EXCEPTION 'segment_not_found'; END IF;
    IF p_shift_id IS NOT NULL AND p_shift_id <> segment_shift_id THEN RAISE EXCEPTION 'segment_shift_mismatch'; END IF;
    effective_shift_id := COALESCE(effective_shift_id, segment_shift_id);
  END IF;

  PERFORM set_config('care_record.skip_version', 'on', true);
  IF target IS NULL THEN
    IF p_status IN ('approved', 'remanded') THEN RAISE EXCEPTION 'invalid_initial_status'; END IF;
    required_scope := create_scope;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;

    IF required_scope = 'assigned'
       AND NOT EXISTS (
         SELECT 1 FROM public.assignments a
          WHERE a.client_id = p_client_id
            AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
       )
       AND NOT (
         actor_staff_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.shifts s
           JOIN public.shift_staffs ss ON ss.shift_id = s.id
            WHERE s.client_id = p_client_id
              AND s.organization_id = p_organization_id
              AND s.deleted_at IS NULL
              AND s.status <> 'cancelled'
              AND ss.staff_id = actor_staff_id
         )
       )
    THEN RAISE EXCEPTION 'access_denied'; END IF;

    IF effective_shift_id IS NULL AND actor_staff_id IS NOT NULL THEN
      SELECT s.id INTO effective_shift_id
        FROM public.shifts s
       WHERE s.organization_id = p_organization_id
         AND s.client_id = p_client_id
         AND s.status <> 'cancelled'
         AND s.deleted_at IS NULL
         AND s.start_at < p_end_at
         AND s.end_at > p_start_at
         AND EXISTS (
           SELECT 1 FROM public.shift_staffs ss
            WHERE ss.shift_id = s.id
              AND ss.staff_id = actor_staff_id
         )
       ORDER BY
         abs(extract(epoch FROM (s.start_at - p_start_at))) + abs(extract(epoch FROM (s.end_at - p_end_at))),
         s.start_at
       LIMIT 1;
    END IF;

    IF effective_shift_id IS NULL THEN
      WITH candidates AS (
        SELECT s.id
          FROM public.shifts s
         WHERE s.organization_id = p_organization_id
           AND s.client_id = p_client_id
           AND s.status <> 'cancelled'
           AND s.deleted_at IS NULL
           AND s.start_at < p_end_at
           AND s.end_at > p_start_at
      )
      SELECT CASE WHEN count(*) = 1 THEN min(id) ELSE NULL END
        INTO effective_shift_id
        FROM candidates;
    END IF;

    INSERT INTO public.reports(client_id, helper_id, start_at, end_at, status, shift_id, segment_id, updated_at)
    VALUES (p_client_id, actor, p_start_at, p_end_at, p_status, effective_shift_id, effective_segment_id, now()) RETURNING id INTO target;
    INSERT INTO public.report_values(report_id, data) VALUES(target, p_values);
  ELSE
    SELECT r.status, r.helper_id, r.shift_id, r.segment_id
      INTO previous_status, existing_helper, existing_shift_id, existing_segment_id
      FROM public.reports r JOIN public.clients c ON c.id = r.client_id
     WHERE r.id = target AND r.client_id = p_client_id AND c.organization_id = p_organization_id
       AND r.deleted_at IS NULL FOR UPDATE;
    IF previous_status IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;
    IF previous_status = 'approved' AND p_status <> 'remanded' THEN RAISE EXCEPTION 'approved_report_locked'; END IF;

    required_scope := CASE WHEN p_status IN ('approved', 'remanded') THEN approve_scope ELSE edit_scope END;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;

    IF required_scope = 'assigned'
       AND existing_helper IS DISTINCT FROM actor
       AND NOT EXISTS (
         SELECT 1 FROM public.assignments a
          WHERE a.client_id = p_client_id
            AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
       )
       AND NOT (
         actor_staff_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.shifts s
           JOIN public.shift_staffs ss ON ss.shift_id = s.id
            WHERE s.client_id = p_client_id
              AND s.organization_id = p_organization_id
              AND s.deleted_at IS NULL
              AND s.status <> 'cancelled'
              AND ss.staff_id = actor_staff_id
         )
       )
    THEN RAISE EXCEPTION 'access_denied'; END IF;

    effective_shift_id := COALESCE(p_shift_id, existing_shift_id);
    effective_segment_id := COALESCE(p_segment_id, existing_segment_id);
    IF effective_shift_id IS NULL THEN
      SELECT rs.shift_id INTO effective_shift_id
        FROM public.report_shifts rs
       WHERE rs.report_id = target
         AND rs.is_primary = true
       ORDER BY rs.created_at
       LIMIT 1;
    END IF;

    UPDATE public.reports SET start_at=p_start_at, end_at=p_end_at, status=p_status,
      shift_id=effective_shift_id, segment_id=effective_segment_id, updated_at=now(),
      approved_by=CASE WHEN p_status='approved' THEN actor WHEN p_status='remanded' THEN NULL ELSE approved_by END,
      approved_at=CASE WHEN p_status='approved' THEN now() WHEN p_status='remanded' THEN NULL ELSE approved_at END
     WHERE id=target;
    IF EXISTS (SELECT 1 FROM public.report_values rv WHERE rv.report_id=target) THEN
      UPDATE public.report_values SET data=p_values WHERE report_id=target;
    ELSE
      INSERT INTO public.report_values(report_id,data) VALUES(target,p_values);
    END IF;
  END IF;

  IF effective_shift_id IS NOT NULL THEN
    UPDATE public.report_shifts
       SET is_primary = false
     WHERE report_id = target
       AND is_primary = true
       AND shift_id <> effective_shift_id;

    INSERT INTO public.report_shifts(report_id, shift_id, is_primary)
    VALUES (target, effective_shift_id, true)
    ON CONFLICT (report_id, shift_id)
    DO UPDATE SET is_primary = true;
  END IF;

  PERFORM private.capture_complete_report_version(target, actor, CASE WHEN p_report_id IS NULL THEN 'create' ELSE 'update:'||p_status END, p_session_id);
  INSERT INTO public.audit_events(organization_id,actor_id,action_type,resource_type,resource_id,outcome,session_id,details)
  VALUES(p_organization_id,actor,CASE WHEN p_report_id IS NULL THEN 'report.create' ELSE 'report.'||p_status END,
    'report',target::text,'success',p_session_id,jsonb_build_object('previousStatus',previous_status,'newStatus',p_status,'shiftId',effective_shift_id,'segmentId',effective_segment_id));
  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) TO authenticated;
