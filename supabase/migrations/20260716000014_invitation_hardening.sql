-- Invitations are email-bound, valid for at most 72 hours, one-time, and
-- reissuing to the same address atomically revokes every older unused link.
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_email_and_72h_check
  CHECK (
    email IS NOT NULL
    AND length(trim(email)) BETWEEN 3 AND 254
    AND expires_at IS NOT NULL
    AND expires_at <= created_at + interval '72 hours'
  ) NOT VALID;

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

REVOKE ALL ON FUNCTION public.create_invitation_authorized(uuid,text,text,text,uuid[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invitation_authorized(uuid,text,text,text,uuid[],uuid) TO authenticated;

-- Preserve the mature atomic membership implementation behind a non-callable
-- internal entry point, then add the mandatory email match at its public edge.
ALTER FUNCTION public.accept_invitation_atomic(text, text)
  RENAME TO accept_invitation_atomic_email_checked_internal;
REVOKE ALL ON FUNCTION public.accept_invitation_atomic_email_checked_internal(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_invitation_atomic(
  p_code text,
  p_session_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_email text := lower(COALESCE(auth.jwt() ->> 'email', ''));
  invitation_email text;
BEGIN
  IF actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT lower(i.email) INTO invitation_email
  FROM public.invitations i
  WHERE i.code = p_code AND i.is_used = false AND i.expires_at > now();
  IF invitation_email IS NULL THEN RAISE EXCEPTION 'invitation_invalid'; END IF;
  IF invitation_email <> actor_email THEN RAISE EXCEPTION 'invitation_email_mismatch'; END IF;
  RETURN public.accept_invitation_atomic_email_checked_internal(p_code, p_session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_atomic(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation_atomic(text, text) TO authenticated;
