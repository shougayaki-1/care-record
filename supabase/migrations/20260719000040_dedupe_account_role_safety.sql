-- Use the shared dangerous-permission predicate instead of maintaining a
-- second inline list in the account role-assignment RPC.
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
    SELECT 1 FROM public.organization_roles r
    WHERE r.id = ANY(COALESCE(p_role_ids, ARRAY[]::uuid[]))
      AND private.role_permissions_dangerous(r.permissions)
  ) THEN RAISE EXCEPTION 'owner_required'; END IF;
  DELETE FROM public.organization_member_roles WHERE organization_id=p_organization_id AND user_id=p_target_user_id;
  INSERT INTO public.organization_member_roles(organization_id,user_id,role_id)
    SELECT p_organization_id,p_target_user_id,rid FROM unnest(COALESCE(p_role_ids, ARRAY[]::uuid[])) rid;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om WHERE om.organization_id=p_organization_id
      AND private.has_management_permission(p_organization_id, om.user_id, 'roles')
  ) THEN RAISE EXCEPTION 'last_role_manager'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.account_replace_member_roles(uuid,uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_replace_member_roles(uuid,uuid,uuid[]) TO authenticated;
