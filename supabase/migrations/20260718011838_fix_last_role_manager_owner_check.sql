-- Fix: mutate_organization_role_authorized's "last role manager" safety check only
-- looked at public.organization_member_roles, so an owner who manages roles solely
-- via the implicit owner grant (private.has_management_permission short-circuits on
-- role='owner') was never counted as a role manager. On a freshly created
-- organization the owner has no explicit organization_member_roles row yet, so the
-- very first role-management mutation raised 'last_role_manager' incorrectly.
--
-- This migration re-defines the function (CREATE OR REPLACE) with the trailing
-- safety check aligned to the same private.has_management_permission(..., 'roles')
-- pattern already used everywhere else in the codebase, so owners are correctly
-- counted as role managers regardless of explicit role assignment.
--
-- Only the final EXISTS check changed; the rest of the function body is unchanged
-- from supabase/migrations/20260716000011_reports_roles_rls.sql.

CREATE OR REPLACE FUNCTION public.mutate_organization_role_authorized(
 p_organization_id uuid,p_role_id uuid,p_action text,p_name text,p_color text,p_permissions jsonb,p_require_preset boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_is_owner boolean;
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
