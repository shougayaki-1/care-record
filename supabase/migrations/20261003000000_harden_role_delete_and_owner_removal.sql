-- Issue #40: strengthen existing authorized deletion paths.
-- Permission definitions and RLS remain unchanged; RPCs enforce owner-only boundaries.
CREATE OR REPLACE FUNCTION public.mutate_organization_role_authorized(
 p_organization_id uuid,p_role_id uuid,p_action text,p_name text,p_color text,p_permissions jsonb,p_require_preset boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_is_owner boolean; v_target public.organization_roles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_org_member(p_organization_id)
    OR NOT private.has_management_permission(p_organization_id,auth.uid(),'roles') THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF p_action IN ('create','update') AND (p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'invalid_role_name' USING ERRCODE='22023'; END IF;
  IF p_action IN ('create','update','reset') AND jsonb_typeof(p_permissions)<>'object' THEN
    RAISE EXCEPTION 'invalid_permissions' USING ERRCODE='22023'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_organization_id AND user_id=auth.uid() AND role='owner') INTO v_is_owner;
  IF p_permissions IS NOT NULL AND private.role_permissions_dangerous(p_permissions) AND NOT v_is_owner THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='42501'; END IF;
  IF p_action='create' THEN
    INSERT INTO public.organization_roles(organization_id,name,color,is_preset,permissions) VALUES(p_organization_id,p_name,p_color,false,p_permissions) RETURNING id INTO v_id;
  ELSIF p_action='update' THEN
    UPDATE public.organization_roles SET name=COALESCE(p_name,name),color=p_color,permissions=p_permissions
      WHERE id=p_role_id AND organization_id=p_organization_id AND (NOT p_require_preset OR is_preset) RETURNING id INTO v_id;
  ELSIF p_action='reset' THEN
    UPDATE public.organization_roles SET permissions=p_permissions
      WHERE id=p_role_id AND organization_id=p_organization_id AND is_preset RETURNING id INTO v_id;
  ELSIF p_action='delete' THEN
    SELECT * INTO v_target FROM public.organization_roles
      WHERE id=p_role_id AND organization_id=p_organization_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'role_not_found' USING ERRCODE='P0002'; END IF;
    IF v_target.is_preset THEN RAISE EXCEPTION 'preset_role_delete_forbidden' USING ERRCODE='42501'; END IF;
    IF private.role_permissions_dangerous(v_target.permissions) AND NOT v_is_owner THEN
      RAISE EXCEPTION 'owner_required' USING ERRCODE='42501'; END IF;
    DELETE FROM public.organization_roles WHERE id=p_role_id AND organization_id=p_organization_id RETURNING id INTO v_id;
  ELSE RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'role_not_found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_members om
    WHERE om.organization_id=p_organization_id AND private.has_management_permission(p_organization_id, om.user_id, 'roles')) THEN
    RAISE EXCEPTION 'last_role_manager' USING ERRCODE='22023'; END IF;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.mutate_organization_role_authorized(uuid,uuid,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mutate_organization_role_authorized(uuid,uuid,text,text,text,jsonb,boolean) TO authenticated;

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
    IF v_role = 'owner' AND NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id=p_organization_id AND user_id=v_actor AND role='owner'
    ) THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='42501'; END IF;
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

REVOKE ALL ON FUNCTION public.account_remove(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_remove(uuid,uuid,text) TO authenticated;
