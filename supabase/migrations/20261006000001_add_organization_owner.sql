-- Issue #85: add ownership without demoting existing owners. No new permission
-- key: this is an owner-only operation, independently of accounts/ownerTransfer.
ALTER TABLE public.reauth_grants DROP CONSTRAINT reauth_grants_purpose_check;
ALTER TABLE public.reauth_grants ADD CONSTRAINT reauth_grants_purpose_check CHECK (purpose IN (
  'owner_transfer', 'owner_add', 'organization_delete', 'external_secret_change', 'backup_restore',
  'account_password_change', 'account_email_change', 'account_delete', 'account_password_reset'
));
ALTER TABLE public.stepup_reauth_challenges DROP CONSTRAINT stepup_reauth_challenges_purpose_check;
ALTER TABLE public.stepup_reauth_challenges ADD CONSTRAINT stepup_reauth_challenges_purpose_check CHECK (purpose IN (
  'owner_transfer', 'owner_add', 'organization_delete', 'external_secret_change', 'backup_restore',
  'account_password_change', 'account_email_change', 'account_delete'
));

-- Session clients read membership, but all mutations go through authorized RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.organization_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO service_role;

CREATE FUNCTION public.add_organization_owner_atomic(p_org_id uuid, p_target_user_id uuid, p_reauth_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp(); v_proof uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  -- The same lock is taken by removal, withdrawal, transfer and org deletion
  -- before checking ownership. Recheck under the lock, never trust Action/UI state.
  PERFORM 1 FROM public.organizations WHERE id=p_org_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members
    WHERE organization_id=p_org_id AND user_id=v_actor AND role='owner') THEN RAISE EXCEPTION 'owner_required'; END IF;
  IF p_target_user_id IS NULL OR p_target_user_id=v_actor THEN RAISE EXCEPTION 'invalid_owner_add_target'; END IF;
  PERFORM 1 FROM public.profiles WHERE id IN (v_actor,p_target_user_id) ORDER BY id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m
    JOIN public.profiles p ON p.id=m.user_id
    JOIN auth.users u ON u.id=m.user_id
    WHERE m.organization_id=p_org_id AND m.user_id=p_target_user_id AND m.role='member'
      AND p.deleted_at IS NULL AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())) THEN RAISE EXCEPTION 'invalid_owner_add_target'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_actor AND deleted_at IS NULL) THEN RAISE EXCEPTION 'owner_required'; END IF;
  -- Recheck session state after waiting, using wall time for expiry. Hold the
  -- session row through commit so a concurrent revocation cannot cross this check.
  PERFORM 1 FROM public.user_session_activity
    WHERE user_id=v_actor AND auth_session_id=(auth.jwt()->>'session_id') AND revoked_at IS NULL
      AND last_activity>=clock_timestamp()-interval '24 hours' AND absolute_expires_at>clock_timestamp()
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authentication_required'; END IF;
  v_now := clock_timestamp();
  UPDATE public.reauth_grants SET used_at=v_now
    WHERE token_hash=encode(extensions.digest(p_reauth_token,'sha256'),'hex')
      AND user_id=v_actor AND auth_session_id=(auth.jwt()->>'session_id')
      AND purpose='owner_add' AND used_at IS NULL AND expires_at>v_now
    RETURNING user_id INTO v_proof;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'owner_add_requires_reauthentication'; END IF;
  UPDATE public.organization_members SET role='owner'
    WHERE organization_id=p_org_id AND user_id=p_target_user_id AND role='member';
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_owner_add_target'; END IF;
  INSERT INTO public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    VALUES(p_org_id,v_actor,auth.jwt()->>'session_id','organization.owner_add','organization_member',p_target_user_id::text,'success',
      jsonb_build_object('beforeRole','member','afterRole','owner','existingOwnersRetained',true));
END $$;
REVOKE ALL ON FUNCTION public.add_organization_owner_atomic(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_organization_owner_atomic(uuid,uuid,text) TO authenticated;

-- Preserve existing mutation behavior while serializing owner changes.
CREATE OR REPLACE FUNCTION public.account_remove(
  p_organization_id uuid, p_target_id uuid, p_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_role text;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id ORDER BY id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.leave_organization_atomic(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_role text; v_members int;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=p_org_id ORDER BY id FOR UPDATE;
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT role INTO v_role FROM public.organization_members WHERE organization_id=p_org_id AND user_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
  SELECT count(*) INTO v_members FROM public.organization_members WHERE organization_id=p_org_id;
  IF v_role='owner' AND (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org_id AND role='owner')<=1
    THEN RAISE EXCEPTION 'sole_owner'; END IF;
  DELETE FROM public.organization_members WHERE organization_id=p_org_id AND user_id=v_actor;
  IF v_members>1 AND NOT EXISTS(SELECT 1 FROM public.organization_members om WHERE om.organization_id=p_org_id
    AND private.has_management_permission(p_org_id,om.user_id,'roles')) THEN RAISE EXCEPTION 'last_role_manager'; END IF;
  UPDATE public.profiles SET last_organization_id=NULL WHERE id=v_actor AND last_organization_id=p_org_id;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_owner_atomic(p_org_id uuid,p_new_owner_id uuid,p_current_owner_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=p_org_id ORDER BY id FOR UPDATE;
  IF v_actor IS NULL OR v_actor<>p_current_owner_id OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.has_management_permission(p_org_id,v_actor,'ownerTransfer') OR NOT EXISTS(
    SELECT 1 FROM public.organization_members WHERE organization_id=p_org_id AND user_id=v_actor AND role='owner') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_new_owner_id=v_actor THEN RAISE EXCEPTION 'invalid_transfer_target'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org_id AND user_id=p_new_owner_id) THEN RAISE EXCEPTION 'target_not_member'; END IF;
  UPDATE public.organization_members SET role='member' WHERE organization_id=p_org_id AND user_id=v_actor;
  UPDATE public.organization_members SET role='owner' WHERE organization_id=p_org_id AND user_id=p_new_owner_id;
END $$;

CREATE OR REPLACE FUNCTION public.soft_delete_organization(p_org_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_now timestamptz:=now(); v_until timestamptz;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id=p_org_id ORDER BY id FOR UPDATE;
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org_id AND user_id=v_actor AND role='owner')
    OR NOT private.has_management_permission(p_org_id,v_actor,'organizationDelete') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  SELECT v_now+make_interval(years=>COALESCE(retention_years,5)) INTO v_until FROM public.organizations WHERE id=p_org_id AND deleted_at IS NULL FOR UPDATE;
  IF v_until IS NULL THEN RAISE EXCEPTION 'organization_not_found'; END IF;
  INSERT INTO public.audit_events(organization_id,actor_id,action_type,resource_type,resource_id,outcome,details)
    VALUES(p_org_id,v_actor,'organization.soft_delete','organization',p_org_id::text,'success',jsonb_build_object('retentionUntil',v_until));
  UPDATE public.profiles SET last_organization_id=NULL WHERE last_organization_id=p_org_id;
  UPDATE public.organizations SET deleted_at=v_now,deleted_by=v_actor,retention_until=v_until WHERE id=p_org_id;
  DELETE FROM public.organization_members WHERE organization_id=p_org_id;
  RETURN v_until;
END $$;

CREATE OR REPLACE FUNCTION public.request_own_account_deletion(p_retention_basis text, p_reauth_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_now timestamptz := now(); v_proof uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  UPDATE public.reauth_grants SET used_at=v_now
    WHERE token_hash=encode(extensions.digest(p_reauth_token, 'sha256'), 'hex')
      AND user_id=v_actor AND auth_session_id=(auth.jwt()->>'session_id')
      AND purpose='account_delete' AND used_at IS NULL AND expires_at>v_now
    RETURNING user_id INTO v_proof;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'account_delete_requires_reauthentication'; END IF;
  -- Lock every affected organization in stable order before removing memberships.
  PERFORM 1 FROM public.organizations o WHERE EXISTS (
    SELECT 1 FROM public.organization_members m WHERE m.organization_id=o.id AND m.user_id=v_actor
  ) ORDER BY o.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id=v_actor AND m.role='owner'
    AND (SELECT count(*) FROM public.organization_members owners WHERE owners.organization_id=m.organization_id AND owners.role='owner')<=1)
    THEN RAISE EXCEPTION 'last_owner'; END IF;
  INSERT INTO public.user_deletion_requests(user_id, retention_basis) VALUES(v_actor, p_retention_basis);
  UPDATE public.profiles SET deleted_at=v_now, deletion_reason='本人による退会申請', last_organization_id=NULL WHERE id=v_actor;
  UPDATE public.staffs SET user_id=NULL WHERE user_id=v_actor;
  DELETE FROM public.organization_members WHERE user_id=v_actor;
END $$;

REVOKE ALL ON FUNCTION public.account_remove(uuid,uuid,text), public.leave_organization_atomic(uuid),
  public.transfer_owner_atomic(uuid,uuid,uuid), public.soft_delete_organization(uuid),
  public.request_own_account_deletion(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_remove(uuid,uuid,text), public.leave_organization_atomic(uuid),
  public.transfer_owner_atomic(uuid,uuid,uuid), public.soft_delete_organization(uuid),
  public.request_own_account_deletion(text,text) TO authenticated;
