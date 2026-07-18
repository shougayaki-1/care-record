-- Accounts/workspace session-client migration. Multi-row mutations stay atomic and
-- every SECURITY DEFINER entry point derives its actor from auth.uid().

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.organization_member_roles TO authenticated;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT UPDATE ON public.notifications TO authenticated;
GRANT INSERT ON public.user_deletion_requests TO authenticated;

DROP POLICY IF EXISTS "Accounts managers read invitations" ON public.invitations;
CREATE POLICY "Accounts managers read invitations" ON public.invitations
  FOR SELECT TO authenticated
  USING (private.has_management_permission(organization_id, auth.uid(), 'accounts'));
DROP POLICY IF EXISTS "Accounts managers delete invitations" ON public.invitations;
CREATE POLICY "Accounts managers delete invitations" ON public.invitations
  FOR DELETE TO authenticated
  USING (private.has_management_permission(organization_id, auth.uid(), 'accounts'));

DROP POLICY IF EXISTS "Accounts managers read role links" ON public.organization_member_roles;
CREATE POLICY "Accounts managers read role links" ON public.organization_member_roles
  FOR SELECT TO authenticated
  USING (private.has_management_permission(organization_id, auth.uid(), 'accounts'));

DROP POLICY IF EXISTS "Users request own deletion" ON public.user_deletion_requests;
CREATE POLICY "Users request own deletion" ON public.user_deletion_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND status = 'requested');

DROP POLICY IF EXISTS "Users upload own avatars" ON storage.objects;
CREATE POLICY "Users upload own avatars" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.account_update_role(
  p_organization_id uuid, p_target_id uuid, p_status text, p_new_role text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_current_role text;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.has_management_permission(p_organization_id, v_actor, 'accounts') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_new_role NOT IN ('owner', 'member') OR p_status NOT IN ('active', 'invited') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF p_status = 'invited' AND p_new_role = 'owner' THEN RAISE EXCEPTION 'invited_owner_forbidden'; END IF;
  IF p_status = 'active' THEN
    SELECT role INTO v_current_role FROM public.organization_members
      WHERE organization_id = p_organization_id AND user_id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'member_not_found'; END IF;
    -- Owner changes are exclusively handled by transfer_owner_atomic after a
    -- one-time owner_transfer reauthentication grant.
    IF v_current_role = 'owner' OR p_new_role = 'owner' THEN
      RAISE EXCEPTION 'owner_transfer_requires_reauthentication';
    END IF;
    IF v_current_role = 'owner' AND p_new_role <> 'owner' AND
       (SELECT count(*) FROM public.organization_members WHERE organization_id = p_organization_id AND role = 'owner') <= 1
    THEN RAISE EXCEPTION 'last_owner'; END IF;
    UPDATE public.organization_members SET role = p_new_role
      WHERE organization_id = p_organization_id AND user_id = p_target_id;
  ELSE
    UPDATE public.invitations SET role = p_new_role
      WHERE id = p_target_id AND organization_id = p_organization_id AND is_used = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found'; END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.account_remove(
  p_organization_id uuid, p_target_id uuid, p_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_role text;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_status NOT IN ('active', 'invited') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF p_status = 'active' AND p_target_id = v_actor THEN
    IF NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'permission_denied'; END IF;
  ELSIF NOT private.has_management_permission(p_organization_id, v_actor, 'accounts') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  IF p_status = 'active' THEN
    SELECT role INTO v_role FROM public.organization_members
      WHERE organization_id = p_organization_id AND user_id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'member_not_found'; END IF;
    IF v_role = 'owner' AND
       (SELECT count(*) FROM public.organization_members WHERE organization_id = p_organization_id AND role = 'owner') <= 1
    THEN RAISE EXCEPTION 'last_owner'; END IF;
    UPDATE public.staffs SET user_id = NULL
      WHERE organization_id = p_organization_id AND user_id = p_target_id AND deleted_at IS NULL;
    DELETE FROM public.organization_members WHERE organization_id = p_organization_id AND user_id = p_target_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = p_organization_id
        AND private.has_management_permission(p_organization_id, om.user_id, 'roles')
    ) THEN RAISE EXCEPTION 'last_role_manager'; END IF;
  ELSE
    DELETE FROM public.invitations WHERE id = p_target_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found'; END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.account_replace_member_roles(
  p_organization_id uuid, p_target_user_id uuid, p_role_ids uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_actor_owner boolean;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.has_management_permission(p_organization_id, v_actor, 'accounts') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = p_organization_id AND user_id = p_target_user_id)
  THEN RAISE EXCEPTION 'member_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_role_ids, ARRAY[]::uuid[])) rid
             LEFT JOIN public.organization_roles r ON r.id = rid AND r.organization_id = p_organization_id WHERE r.id IS NULL)
  THEN RAISE EXCEPTION 'invalid_role'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id=p_organization_id AND user_id=v_actor AND role='owner') INTO v_actor_owner;
  IF NOT v_actor_owner AND EXISTS (
    SELECT 1 FROM public.organization_roles r WHERE r.id = ANY(COALESCE(p_role_ids, ARRAY[]::uuid[]))
      AND (COALESCE((r.permissions #>> '{management,accounts}')::boolean,false)
        OR COALESCE((r.permissions #>> '{management,roles}')::boolean,false)
        OR COALESCE((r.permissions #>> '{management,organizationDelete}')::boolean,false)
        OR COALESCE((r.permissions #>> '{management,ownerTransfer}')::boolean,false))
  ) THEN RAISE EXCEPTION 'owner_required'; END IF;
  DELETE FROM public.organization_member_roles WHERE organization_id=p_organization_id AND user_id=p_target_user_id;
  INSERT INTO public.organization_member_roles(organization_id,user_id,role_id)
    SELECT p_organization_id,p_target_user_id,rid FROM unnest(COALESCE(p_role_ids, ARRAY[]::uuid[])) rid;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om WHERE om.organization_id=p_organization_id
      AND private.has_management_permission(p_organization_id, om.user_id, 'roles')
  ) THEN RAISE EXCEPTION 'last_role_manager'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.request_own_account_deletion(p_retention_basis text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_now timestamptz := now();
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  INSERT INTO public.user_deletion_requests(user_id, retention_basis) VALUES(v_actor, p_retention_basis);
  UPDATE public.profiles SET deleted_at=v_now, deletion_reason='本人による退会申請', last_organization_id=NULL WHERE id=v_actor;
  UPDATE public.staffs SET user_id=NULL WHERE user_id=v_actor;
  DELETE FROM public.organization_members WHERE user_id=v_actor;
END $$;

CREATE OR REPLACE FUNCTION public.get_invitation_preview(p_code text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT jsonb_build_object('organizationId', i.organization_id, 'orgName', o.name,
    'targetName', i.target_name,
    'roleNames', COALESCE((SELECT jsonb_agg(r.name ORDER BY r.name)
      FROM public.organization_roles r WHERE r.organization_id=i.organization_id AND r.id=ANY(COALESCE(i.role_ids, ARRAY[]::uuid[]))), '[]'::jsonb),
    'expiresAt', i.expires_at)
  FROM public.invitations i JOIN public.organizations o ON o.id=i.organization_id
  WHERE i.code=p_code AND NOT i.is_used AND i.expires_at>now() LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.account_update_role(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_remove(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_replace_member_roles(uuid,uuid,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_own_account_deletion(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_invitation_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_update_role(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_remove(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_replace_member_roles(uuid,uuid,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_own_account_deletion(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_preview(text) TO anon, authenticated;
