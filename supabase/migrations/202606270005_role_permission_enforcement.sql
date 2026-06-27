-- Align shift SELECT policies with flexible role permissions.

CREATE OR REPLACE FUNCTION private.get_member_shift_action_scope(
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
            AND (r.permissions -> 'shifts' ->> p_action) = 'all'
        ) THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'shifts' ->> p_action) = 'assigned'
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

CREATE OR REPLACE FUNCTION private.get_actor_staff_id(p_org_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
STABLE
AS $$
  SELECT st.id
  FROM public.staffs st
  WHERE st.organization_id = p_org_id
    AND st.user_id = p_user_id
    AND st.deleted_at IS NULL
  ORDER BY st.sort_order NULLS LAST, st.name
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.is_assigned_client_for_user(
  p_client_id uuid,
  p_org_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    WHERE a.client_id = p_client_id
      AND (
        a.helper_id = p_user_id
        OR a.staff_id = private.get_actor_staff_id(p_org_id, p_user_id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_shift(p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
STABLE
AS $$
  WITH target AS (
    SELECT s.id, s.organization_id, s.client_id
    FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.deleted_at IS NULL
  ),
  scope AS (
    SELECT t.*, private.get_member_shift_action_scope(t.organization_id, auth.uid(), 'view') AS value
    FROM target t
    WHERE EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = t.organization_id
        AND om.user_id = auth.uid()
    )
  )
  SELECT EXISTS (
    SELECT 1
    FROM scope s
    WHERE s.value = 'all'
      OR (
        s.value = 'assigned'
        AND (
          private.is_assigned_client_for_user(s.client_id, s.organization_id, auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.shift_staffs ss
            WHERE ss.shift_id = s.id
              AND ss.staff_id = private.get_actor_staff_id(s.organization_id, auth.uid())
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.can_access_shift_pattern(p_pattern_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
STABLE
AS $$
  WITH target AS (
    SELECT sp.id, sp.organization_id, sp.client_id
    FROM public.shift_patterns sp
    WHERE sp.id = p_pattern_id
      AND sp.deleted_at IS NULL
  ),
  scope AS (
    SELECT t.*, private.get_member_shift_action_scope(t.organization_id, auth.uid(), 'view') AS value
    FROM target t
    WHERE EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = t.organization_id
        AND om.user_id = auth.uid()
    )
  )
  SELECT EXISTS (
    SELECT 1
    FROM scope s
    WHERE s.value = 'all'
      OR (
        s.value = 'assigned'
        AND (
          private.is_assigned_client_for_user(s.client_id, s.organization_id, auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.shift_pattern_staffs sps
            WHERE sps.pattern_id = s.id
              AND sps.staff_id = private.get_actor_staff_id(s.organization_id, auth.uid())
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.get_member_shift_action_scope(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.get_actor_staff_id(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_assigned_client_for_user(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_access_shift_pattern(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_member_shift_action_scope(uuid, uuid, text), private.get_actor_staff_id(uuid, uuid), private.is_assigned_client_for_user(uuid, uuid, uuid), private.can_access_shift(uuid), private.can_access_shift_pattern(uuid) TO authenticated;

DROP POLICY IF EXISTS "Tenant boundary shifts" ON public.shifts;
CREATE POLICY "Tenant boundary shifts" ON public.shifts AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_shift(id)));

DROP POLICY IF EXISTS "Tenant boundary shift staffs" ON public.shift_staffs;
CREATE POLICY "Tenant boundary shift staffs" ON public.shift_staffs AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_shift(shift_id)));

DROP POLICY IF EXISTS "Tenant boundary shift patterns" ON public.shift_patterns;
CREATE POLICY "Tenant boundary shift patterns" ON public.shift_patterns AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_shift_pattern(id)));

DROP POLICY IF EXISTS "Tenant boundary shift pattern staffs" ON public.shift_pattern_staffs;
CREATE POLICY "Tenant boundary shift pattern staffs" ON public.shift_pattern_staffs AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_shift_pattern(pattern_id)));
