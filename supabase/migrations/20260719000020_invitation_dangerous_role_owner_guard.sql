-- The invitation RPC is SECURITY DEFINER and callable by authenticated users.
-- Keep its dangerous-role authorization equivalent to the Server Action so a
-- direct PostgREST RPC call cannot bypass the owner-only restriction.
CREATE OR REPLACE FUNCTION public.create_invitation_authorized(
  p_organization_id uuid,
  p_code text,
  p_email text,
  p_target_name text,
  p_role_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_staff_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  normalized_email text := lower(trim(p_email));
  role_ids uuid[] := COALESCE(p_role_ids, ARRAY[]::uuid[]);
  v_is_owner boolean;
BEGIN
  IF actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.has_management_permission(p_organization_id, actor, 'accounts') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_code IS NULL OR length(p_code) < 8 OR length(p_code) > 128
     OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR length(normalized_email) > 254
     OR length(trim(p_target_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;
  IF cardinality(role_ids) <> (
    SELECT count(*)::integer FROM public.organization_roles r
    WHERE r.organization_id = p_organization_id AND r.id = ANY(role_ids)
  ) THEN RAISE EXCEPTION 'invalid_role_ids'; END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = actor
      AND om.role = 'owner'
  ) INTO v_is_owner;
  IF EXISTS(
    SELECT 1
    FROM public.organization_roles r
    WHERE r.organization_id = p_organization_id
      AND r.id = ANY(role_ids)
      AND private.role_permissions_dangerous(r.permissions)
  ) AND NOT v_is_owner THEN
    RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.staffs s
    WHERE s.id = p_staff_id AND s.organization_id = p_organization_id
      AND s.user_id IS NULL AND s.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'invalid_staff'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || normalized_email, 0));
  UPDATE public.invitations
  SET is_used = true
  WHERE organization_id = p_organization_id AND lower(email) = normalized_email AND is_used = false;

  INSERT INTO public.invitations (
    organization_id, code, email, created_by, target_name, staff_id, role_ids, expires_at
  ) VALUES (
    p_organization_id, p_code, normalized_email, actor, trim(p_target_name), p_staff_id,
    role_ids, now() + interval '72 hours'
  );
END;
$$;
