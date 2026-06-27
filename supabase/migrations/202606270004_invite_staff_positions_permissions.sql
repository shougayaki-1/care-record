-- Invitation/staff linking, staff position presets, and record action scopes.

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staffs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invitations_staff_idx
  ON public.invitations (staff_id)
  WHERE staff_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.staff_position_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE public.staff_position_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read staff position presets" ON public.staff_position_presets;
CREATE POLICY "Org members read staff position presets"
  ON public.staff_position_presets FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

REVOKE INSERT, UPDATE, DELETE ON public.staff_position_presets FROM authenticated;

INSERT INTO public.staff_position_presets (organization_id, name, sort_order)
SELECT o.id, preset.name, preset.sort_order
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('サービス提供責任者', 0),
    ('管理者', 1),
    ('ヘルパー', 2),
    ('常勤ヘルパー', 3),
    ('非常勤ヘルパー', 4),
    ('事務員', 5),
    ('看護師', 6)
) AS preset(name, sort_order)
ON CONFLICT (organization_id, name) DO NOTHING;

CREATE OR REPLACE FUNCTION private.get_member_record_action_scope(
  p_org_id uuid,
  p_user_id uuid,
  p_action text
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN om.role = 'owner' THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'records' ->> p_action) = 'all'
        ) THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'records' ->> p_action) = 'assigned'
        ) THEN 'assigned'
        ELSE 'none'
      END
      FROM public.organization_members om
      WHERE om.organization_id = p_org_id
        AND om.user_id = p_user_id
    ),
    'none'
  )
$$;

CREATE OR REPLACE FUNCTION private.get_member_record_view_scope(p_org_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
STABLE
AS $$
  SELECT private.get_member_record_action_scope(p_org_id, p_user_id, 'view')
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation_atomic(p_code text, p_session_id text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inv public.invitations%ROWTYPE;
  v_role_id uuid;
  v_existing_profile_name text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_inv
    FROM public.invitations
   WHERE code = p_code
     AND is_used = false
     AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_invalid'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE organization_id = v_inv.organization_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_inv.organization_id, v_actor, 'member')
  ON CONFLICT DO NOTHING;

  IF v_inv.role_ids IS NOT NULL THEN
    FOREACH v_role_id IN ARRAY v_inv.role_ids LOOP
      INSERT INTO public.organization_member_roles (organization_id, user_id, role_id)
      VALUES (v_inv.organization_id, v_actor, v_role_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  IF v_inv.target_client_ids IS NOT NULL THEN
    INSERT INTO public.assignments (client_id, helper_id)
    SELECT elem::uuid, v_actor
      FROM jsonb_array_elements_text(to_jsonb(v_inv.target_client_ids)) AS elem
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT name INTO v_existing_profile_name
    FROM public.profiles
   WHERE id = v_actor;

  INSERT INTO public.profiles (id, name, last_organization_id)
  VALUES (v_actor, NULLIF(trim(COALESCE(v_inv.target_name, '')), ''), v_inv.organization_id)
  ON CONFLICT (id) DO UPDATE SET
    name = CASE
      WHEN NULLIF(trim(COALESCE(public.profiles.name, '')), '') IS NULL
        THEN NULLIF(trim(COALESCE(v_inv.target_name, '')), '')
      ELSE public.profiles.name
    END,
    last_organization_id = v_inv.organization_id;

  IF v_inv.staff_id IS NOT NULL THEN
    UPDATE public.staffs
       SET user_id = v_actor
     WHERE id = v_inv.staff_id
       AND organization_id = v_inv.organization_id
       AND user_id IS NULL
       AND deleted_at IS NULL;
  END IF;

  UPDATE public.invitations SET is_used = true WHERE id = v_inv.id AND is_used = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_already_used'; END IF;

  INSERT INTO public.audit_events (organization_id, actor_id, action_type, resource_type, resource_id, outcome, session_id, details)
  VALUES (
    v_inv.organization_id, v_actor,
    'account.invitation_accept', 'invitation', v_inv.id::text,
    'success', p_session_id,
    jsonb_build_object(
      'role', 'member',
      'role_ids', to_jsonb(v_inv.role_ids),
      'staff_id', v_inv.staff_id,
      'profileNameInitialized', NULLIF(trim(COALESCE(v_existing_profile_name, '')), '') IS NULL
    )
  );

  RETURN v_inv.organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_atomic(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation_atomic(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_report_atomic(
  p_organization_id uuid,
  p_report_id uuid,
  p_client_id uuid,
  p_shift_id uuid,
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
  effective_shift_id uuid := p_shift_id;
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

  PERFORM set_config('care_record.skip_version', 'on', true);
  IF target IS NULL THEN
    IF p_status IN ('approved', 'remanded') THEN RAISE EXCEPTION 'invalid_initial_status'; END IF;
    required_scope := create_scope;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;
    IF required_scope = 'assigned' AND NOT EXISTS (
      SELECT 1 FROM public.assignments a
       WHERE a.client_id = p_client_id
         AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
    ) THEN RAISE EXCEPTION 'access_denied'; END IF;

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

    INSERT INTO public.reports(client_id, helper_id, start_at, end_at, status, shift_id, updated_at)
    VALUES (p_client_id, actor, p_start_at, p_end_at, p_status, effective_shift_id, now()) RETURNING id INTO target;
    INSERT INTO public.report_values(report_id, data) VALUES(target, p_values);
  ELSE
    SELECT r.status, r.helper_id, r.shift_id INTO previous_status, existing_helper, existing_shift_id
      FROM public.reports r JOIN public.clients c ON c.id = r.client_id
     WHERE r.id = target AND r.client_id = p_client_id AND c.organization_id = p_organization_id
       AND r.deleted_at IS NULL FOR UPDATE;
    IF previous_status IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;
    IF previous_status = 'approved' AND p_status <> 'remanded' THEN RAISE EXCEPTION 'approved_report_locked'; END IF;

    required_scope := CASE WHEN p_status IN ('approved', 'remanded') THEN approve_scope ELSE edit_scope END;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;
    IF required_scope = 'assigned' AND existing_helper IS DISTINCT FROM actor AND NOT EXISTS (
      SELECT 1 FROM public.assignments a
       WHERE a.client_id = p_client_id
         AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
    ) THEN RAISE EXCEPTION 'access_denied'; END IF;

    effective_shift_id := COALESCE(p_shift_id, existing_shift_id);
    IF effective_shift_id IS NULL THEN
      SELECT rs.shift_id INTO effective_shift_id
        FROM public.report_shifts rs
       WHERE rs.report_id = target
         AND rs.is_primary = true
       ORDER BY rs.created_at
       LIMIT 1;
    END IF;

    UPDATE public.reports SET start_at=p_start_at, end_at=p_end_at, status=p_status,
      shift_id=effective_shift_id, updated_at=now(),
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
    'report',target::text,'success',p_session_id,jsonb_build_object('previousStatus',previous_status,'newStatus',p_status,'shiftId',effective_shift_id));
  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) TO authenticated;
