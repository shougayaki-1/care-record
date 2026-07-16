-- Organization/deletion workflows use caller JWTs. SECURITY DEFINER functions
-- derive the actor from auth.uid() and repeat session, tenant and permission checks.

GRANT SELECT ON public.deletion_requests, public.audit_events TO authenticated;

CREATE POLICY "Report managers read deletion requests" ON public.deletion_requests
  FOR SELECT TO authenticated USING (
    private.is_session_active()
    AND private.has_management_permission(organization_id, auth.uid(), 'reports')
  );
CREATE POLICY "Audit managers read audit events" ON public.audit_events
  FOR SELECT TO authenticated USING (
    private.is_session_active()
    AND private.has_management_permission(organization_id, auth.uid(), 'auditLogs')
  );

CREATE OR REPLACE FUNCTION public.request_report_deletion(p_org_id uuid, p_report_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF length(trim(p_reason)) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'invalid_reason'; END IF;
  IF NOT public.is_org_member(p_org_id) THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reports r JOIN public.clients c ON c.id=r.client_id
    WHERE r.id=p_report_id AND c.organization_id=p_org_id AND r.deleted_at IS NULL) THEN RAISE EXCEPTION 'report_not_found'; END IF;
  INSERT INTO public.deletion_requests(organization_id,resource_type,resource_id,requested_by,reason,status)
  VALUES(p_org_id,'report',p_report_id,v_actor,trim(p_reason),'requested') RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.decide_report_deletion(p_org_id uuid, p_request_id uuid, p_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_req public.deletion_requests%ROWTYPE; v_now timestamptz:=now(); v_until timestamptz; v_scope text;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  IF NOT private.has_management_permission(p_org_id,v_actor,'reports') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  SELECT * INTO v_req FROM public.deletion_requests WHERE id=p_request_id AND organization_id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.status<>'requested' THEN RAISE EXCEPTION 'already_decided'; END IF;
  IF v_req.resource_type<>'report' THEN RAISE EXCEPTION 'unsupported_resource'; END IF;
  IF p_decision='approve' THEN
    v_scope:=private.get_member_record_action_scope(p_org_id,v_actor,'delete');
    IF v_scope='none' OR (v_scope='assigned' AND NOT EXISTS(
      SELECT 1 FROM public.reports r JOIN public.clients c ON c.id=r.client_id
      WHERE r.id=v_req.resource_id AND c.organization_id=p_org_id AND r.helper_id=v_actor AND r.deleted_at IS NULL
    )) THEN RAISE EXCEPTION 'record_permission_denied'; END IF;
    SELECT v_now + make_interval(years=>COALESCE(retention_years,5)) INTO v_until FROM public.organizations WHERE id=p_org_id AND deleted_at IS NULL;
    IF v_until IS NULL THEN RAISE EXCEPTION 'organization_not_found'; END IF;
    UPDATE public.reports SET deleted_at=v_now,deleted_by=v_actor,deletion_reason=v_req.reason,retention_until=v_until,updated_at=v_now
      WHERE id=v_req.resource_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found'; END IF;
    UPDATE public.deletion_requests SET status='completed',approved_by=v_actor,decided_at=v_now,completed_at=v_now WHERE id=p_request_id;
  ELSE
    UPDATE public.deletion_requests SET status='rejected',approved_by=v_actor,decided_at=v_now WHERE id=p_request_id;
  END IF;
  RETURN jsonb_build_object('resourceId',v_req.resource_id,'retentionUntil',v_until);
END $$;

CREATE OR REPLACE FUNCTION public.update_organization_setting(p_org_id uuid,p_setting text,p_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_area text;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  v_area:=CASE WHEN p_setting IN ('drive_folder','calendar_disconnect') THEN 'integrations' ELSE 'organization' END;
  IF NOT private.has_management_permission(p_org_id,v_actor,v_area) THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_setting='name' THEN
    IF length(trim(COALESCE(p_value,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_name'; END IF;
    UPDATE public.organizations SET name=trim(p_value) WHERE id=p_org_id AND deleted_at IS NULL;
  ELSIF p_setting='drive_folder' THEN
    IF length(COALESCE(p_value,''))>255 THEN RAISE EXCEPTION 'invalid_folder'; END IF;
    UPDATE public.organizations SET google_folder_id=NULLIF(trim(p_value),'') WHERE id=p_org_id AND deleted_at IS NULL;
  ELSIF p_setting='travel_rate' THEN
    IF p_value::numeric<0 OR p_value::numeric>10000 THEN RAISE EXCEPTION 'invalid_rate'; END IF;
    UPDATE public.organizations SET travel_cost_rate_yen_per_km=p_value::numeric WHERE id=p_org_id AND deleted_at IS NULL;
  ELSIF p_setting='calendar_disconnect' THEN
    UPDATE public.organizations SET google_calendar_id=NULL,google_refresh_token=NULL,google_connection_status='disconnected',
      google_connection_checked_at=now(),google_connection_error_code=NULL WHERE id=p_org_id AND deleted_at IS NULL;
  ELSE RAISE EXCEPTION 'invalid_setting'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_not_found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.soft_delete_organization(p_org_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_now timestamptz:=now(); v_until timestamptz;
BEGIN
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

CREATE OR REPLACE FUNCTION public.leave_organization_atomic(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_role text; v_members int;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT role INTO v_role FROM public.organization_members WHERE organization_id=p_org_id AND user_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_member'; END IF;
  SELECT count(*) INTO v_members FROM public.organization_members WHERE organization_id=p_org_id;
  IF v_role='owner' AND v_members>1 AND (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org_id AND role='owner')<=1
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
  IF v_actor IS NULL OR v_actor<>p_current_owner_id OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.has_management_permission(p_org_id,v_actor,'ownerTransfer') OR NOT EXISTS(
    SELECT 1 FROM public.organization_members WHERE organization_id=p_org_id AND user_id=v_actor AND role='owner') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_new_owner_id=v_actor THEN RAISE EXCEPTION 'invalid_transfer_target'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org_id AND user_id=p_new_owner_id) THEN RAISE EXCEPTION 'target_not_member'; END IF;
  UPDATE public.organization_members SET role='member' WHERE organization_id=p_org_id AND user_id=v_actor;
  UPDATE public.organization_members SET role='owner' WHERE organization_id=p_org_id AND user_id=p_new_owner_id;
END $$;

REVOKE ALL ON FUNCTION public.request_report_deletion(uuid,uuid,text), public.decide_report_deletion(uuid,uuid,text),
 public.update_organization_setting(uuid,text,text), public.soft_delete_organization(uuid), public.leave_organization_atomic(uuid),
 public.transfer_owner_atomic(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_report_deletion(uuid,uuid,text), public.decide_report_deletion(uuid,uuid,text),
 public.update_organization_setting(uuid,text,text), public.soft_delete_organization(uuid), public.leave_organization_atomic(uuid),
 public.transfer_owner_atomic(uuid,uuid,uuid) TO authenticated;
