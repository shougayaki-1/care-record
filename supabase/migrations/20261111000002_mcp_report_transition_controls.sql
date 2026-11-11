-- Report-transition-specific consent controls; updates and audit events commit together.
create function public.disable_mcp_report_transition(p_organization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_before boolean;
begin
  if v_actor is null or not private.is_session_active() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not private.has_management_permission(p_organization_id, v_actor, 'integrations') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform 1 from public.organizations where id = p_organization_id and deleted_at is null for update;
  if not found then raise exception 'permission_denied' using errcode = '42501'; end if;
  perform 1 from public.organization_members where organization_id=p_organization_id and user_id=v_actor for share;
  if not found then raise exception 'permission_denied' using errcode = '42501'; end if;
  lock table public.organization_member_roles,public.organization_roles in share mode;
  perform 1 from public.user_session_activity where user_id=v_actor and auth_session_id=auth.jwt()->>'session_id'
    and revoked_at is null and last_activity>=clock_timestamp()-interval '24 hours' and absolute_expires_at>clock_timestamp() for share;
  if not found or not private.is_session_active()
     or private.has_management_permission(p_organization_id, v_actor, 'integrations') is distinct from true then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select enabled into v_before from private.mcp_report_transition_controls where organization_id = p_organization_id;
  insert into private.mcp_report_transition_controls (organization_id, enabled) values (p_organization_id, false)
    on conflict (organization_id) do update set enabled = false;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_report_transition.disable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', false));
end $$;
revoke all on function public.disable_mcp_report_transition(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.disable_mcp_report_transition(uuid) to authenticated;

-- Conditions are manager attestations, not independent verification by this system.
-- Treat these fields as references or concise non-sensitive summaries, never record data or secrets.
create function public.enable_mcp_report_transition(p_organization_id uuid, p_conditions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_key text; v_conditions jsonb := '{}'::jsonb;
  v_before boolean; v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not private.is_session_active() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not private.has_management_permission(p_organization_id, v_actor, 'integrations') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'object' then
    raise exception 'invalid_mcp_conditions' using errcode = '22023';
  end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(p_conditions)) <> 6 then
    raise exception 'invalid_mcp_conditions' using errcode = '22023';
  end if;
  foreach v_key in array array['provider','processing','region','retention','secondary_use','notice'] loop
    if jsonb_typeof(p_conditions -> v_key) is distinct from 'string'
       or p_conditions ->> v_key !~ '[^[:space:]]'
       or char_length(btrim(p_conditions ->> v_key)) not between 1 and 500 then
      raise exception 'invalid_mcp_conditions' using errcode = '22023';
    end if;
    v_conditions := v_conditions || jsonb_build_object(v_key, btrim(p_conditions ->> v_key));
  end loop;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform 1 from public.organizations where id = p_organization_id and deleted_at is null for update;
  if not found then raise exception 'permission_denied' using errcode = '42501'; end if;
  perform 1 from public.organization_members where organization_id=p_organization_id and user_id=v_actor for share;
  if not found then raise exception 'permission_denied' using errcode = '42501'; end if;
  lock table public.organization_member_roles,public.organization_roles in share mode;
  perform 1 from public.user_session_activity where user_id=v_actor and auth_session_id=auth.jwt()->>'session_id'
    and revoked_at is null and last_activity>=clock_timestamp()-interval '24 hours' and absolute_expires_at>clock_timestamp() for share;
  if not found or not private.is_session_active()
     or private.has_management_permission(p_organization_id, v_actor, 'integrations') is distinct from true then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_now := clock_timestamp();
  select enabled into v_before from private.mcp_report_transition_controls where organization_id = p_organization_id;
  insert into private.mcp_report_transition_controls (organization_id, enabled, conditions, confirmed_by, confirmed_at)
    values (p_organization_id, true, v_conditions, v_actor, v_now)
    on conflict (organization_id) do update set enabled = true, conditions = excluded.conditions,
      confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_report_transition.enable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', true,
        'confirmedFields', jsonb_build_array('provider','processing','region','retention','secondary_use','notice'),
        'confirmedAt', v_now));
end $$;
revoke all on function public.enable_mcp_report_transition(uuid,jsonb) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.enable_mcp_report_transition(uuid,jsonb) to authenticated;

create function public.get_mcp_report_transition_control(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result jsonb;
begin
  if v_actor is null or not private.is_session_active() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not private.is_org_member(p_organization_id)
     or not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null)
     or private.has_management_permission(p_organization_id, v_actor, 'integrations') is distinct from true then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select jsonb_build_object('enabled', enabled, 'conditions', conditions, 'confirmed_at', confirmed_at)
    into v_result from private.mcp_report_transition_controls where organization_id = p_organization_id;
  return coalesce(v_result, jsonb_build_object('enabled', false, 'conditions', null, 'confirmed_at', null));
end $$;
revoke all on function public.get_mcp_report_transition_control(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_report_transition_control(uuid) to authenticated;


notify pgrst, 'reload schema';
