-- Google sync DB boundary. OAuth tokens remain server-only while every caller
-- is tied to an active JWT session and an authorized organization/shift.

CREATE OR REPLACE FUNCTION public.get_google_sync_target(p_org_id uuid,p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; shift_org uuid; allowed boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT organization_id INTO shift_org FROM public.shifts WHERE id=p_shift_id;
  IF shift_org IS DISTINCT FROM p_org_id THEN RAISE EXCEPTION 'shift outside organization'; END IF;
  allowed := private.get_member_shift_action_scope(p_org_id,auth.uid(),'edit')='all'
    OR private.get_member_shift_action_scope(p_org_id,auth.uid(),'delete')='all'
    OR (private.get_member_shift_action_scope(p_org_id,auth.uid(),'edit')<>'none' AND private.can_access_shift(p_shift_id));
  IF NOT allowed THEN RAISE EXCEPTION 'shift sync permission required'; END IF;
  SELECT jsonb_build_object(
    'organization',jsonb_build_object('google_calendar_id',o.google_calendar_id,'google_refresh_token',o.google_refresh_token),
    'shift',to_jsonb(s) || jsonb_build_object('shift_staffs',COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id',ss.staff_id)) FROM public.shift_staffs ss WHERE ss.shift_id=s.id),'[]'::jsonb))
  ) INTO result FROM public.organizations o JOIN public.shifts s ON s.organization_id=o.id
    WHERE o.id=p_org_id AND s.id=p_shift_id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.mark_shift_google_sync(
  p_shift_id uuid,p_status text,p_event_id text,p_set_event_id boolean,p_error text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid; allowed boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF p_status NOT IN ('synced','pending_upsert','pending_delete','failed') THEN RAISE EXCEPTION 'invalid sync status'; END IF;
  SELECT organization_id INTO org FROM public.shifts WHERE id=p_shift_id FOR UPDATE;
  IF org IS NULL THEN RAISE EXCEPTION 'shift not found'; END IF;
  allowed := private.get_member_shift_action_scope(org,auth.uid(),'edit')='all'
    OR private.get_member_shift_action_scope(org,auth.uid(),'delete')='all'
    OR (private.get_member_shift_action_scope(org,auth.uid(),'edit')<>'none' AND private.can_access_shift(p_shift_id));
  IF NOT allowed THEN RAISE EXCEPTION 'shift sync permission required'; END IF;
  UPDATE public.shifts SET google_sync_status=p_status,google_sync_error=p_error,
    google_synced_at=CASE WHEN p_status='synced' THEN now() ELSE NULL END,
    google_event_id=CASE WHEN p_set_event_id THEN p_event_id ELSE google_event_id END
    WHERE id=p_shift_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_google_connection_health(p_org_id uuid,p_status text,p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active()
    OR NOT private.has_management_permission(p_org_id,auth.uid(),'integrations') THEN
    RAISE EXCEPTION 'integration permission required';
  END IF;
  IF p_status NOT IN ('disconnected','healthy','reauth_required','calendar_missing','forbidden','misconfigured','temporarily_unavailable') THEN RAISE EXCEPTION 'invalid connection status'; END IF;
  UPDATE public.organizations SET google_connection_status=p_status,google_connection_checked_at=now(),google_connection_error_code=p_error_code WHERE id=p_org_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_google_oauth_context(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active()
    OR NOT private.has_management_permission(p_org_id,auth.uid(),'integrations') THEN
    RAISE EXCEPTION 'integration permission required';
  END IF;
  SELECT jsonb_build_object('name',o.name,'google_calendar_id',o.google_calendar_id)
    INTO result FROM public.organizations o WHERE o.id=p_org_id AND o.deleted_at IS NULL;
  IF result IS NULL THEN RAISE EXCEPTION 'organization not found'; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.complete_google_oauth_connection(
  p_org_id uuid,p_encrypted_refresh_token text,p_calendar_id text,p_status text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active()
    OR NOT private.has_management_permission(p_org_id,auth.uid(),'integrations') THEN
    RAISE EXCEPTION 'integration permission required';
  END IF;
  IF p_encrypted_refresh_token IS NULL OR length(p_encrypted_refresh_token) NOT BETWEEN 20 AND 8192
    OR p_calendar_id IS NULL OR length(p_calendar_id) NOT BETWEEN 3 AND 1024
    OR p_status NOT IN ('healthy','calendar_missing') THEN
    RAISE EXCEPTION 'invalid oauth connection';
  END IF;
  UPDATE public.organizations SET
    google_refresh_token=p_encrypted_refresh_token,
    google_calendar_id=p_calendar_id,
    google_connection_status=p_status,
    google_connection_checked_at=now(),
    google_connection_error_code=CASE WHEN p_status='healthy' THEN NULL ELSE 'calendar_missing' END
  WHERE id=p_org_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization not found'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_google_sync_target(uuid,uuid), public.mark_shift_google_sync(uuid,text,text,boolean,text), public.update_google_connection_health(uuid,text,text), public.get_google_oauth_context(uuid), public.complete_google_oauth_connection(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_google_sync_target(uuid,uuid), public.mark_shift_google_sync(uuid,text,text,boolean,text), public.update_google_connection_health(uuid,text,text), public.get_google_oauth_context(uuid), public.complete_google_oauth_connection(uuid,text,text,text) TO authenticated;
