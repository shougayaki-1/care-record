-- MCP submission is disabled for every organization unless expressly enabled.
-- A manager must record the six required processing-condition checks before enablement.
-- Existing candidate review is unaffected.
create table private.mcp_import_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_import_controls enable row level security;
revoke all on table private.mcp_import_controls from public, anon, authenticated, service_role, mcp_import;

-- Only the existing integrations management permission can disable submissions.
-- Update and audit must commit together; if the audit fails the change rolls back.
create function public.disable_mcp_import(p_organization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_before boolean;
begin
  if v_actor is null or not private.is_session_active() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not private.has_management_permission(p_organization_id, v_actor, 'integrations') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = p_organization_id and deleted_at is null for update;
  if not found or not private.is_session_active()
     or not private.has_management_permission(p_organization_id, v_actor, 'integrations') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select enabled into v_before from private.mcp_import_controls where organization_id = p_organization_id;
  insert into private.mcp_import_controls (organization_id, enabled) values (p_organization_id, false)
    on conflict (organization_id) do update set enabled = false;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_import.disable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', false));
end $$;
revoke all on function public.disable_mcp_import(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.disable_mcp_import(uuid) to authenticated;

-- Conditions are manager attestations, not independent verification by this system.
-- Treat these fields as references or concise non-sensitive summaries, never record data or secrets.
create function public.enable_mcp_import(p_organization_id uuid, p_conditions jsonb)
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
  perform 1 from public.organizations where id = p_organization_id and deleted_at is null for update;
  if not found or not private.is_session_active()
     or not private.has_management_permission(p_organization_id, v_actor, 'integrations') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_now := clock_timestamp();
  select enabled into v_before from private.mcp_import_controls where organization_id = p_organization_id;
  insert into private.mcp_import_controls (organization_id, enabled, conditions, confirmed_by, confirmed_at)
    values (p_organization_id, true, v_conditions, v_actor, v_now)
    on conflict (organization_id) do update set enabled = true, conditions = excluded.conditions,
      confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_import.enable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', true,
        'confirmedFields', jsonb_build_array('provider','processing','region','retention','secondary_use','notice'),
        'confirmedAt', v_now));
end $$;
revoke all on function public.enable_mcp_import(uuid,jsonb) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.enable_mcp_import(uuid,jsonb) to authenticated;

create function public.get_mcp_import_control(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_result jsonb;
begin
  if v_actor is null or not private.is_session_active() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not private.has_management_permission(p_organization_id, v_actor, 'integrations') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select jsonb_build_object('enabled', enabled, 'conditions', conditions, 'confirmed_at', confirmed_at)
    into v_result from private.mcp_import_controls where organization_id = p_organization_id;
  return coalesce(v_result, jsonb_build_object('enabled', false, 'conditions', null, 'confirmed_at', null));
end $$;
revoke all on function public.get_mcp_import_control(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_import_control(uuid) to authenticated;

create or replace function public.submit_mcp_candidate(
  p_organization_id uuid, p_source_file_name text, p_payload jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or auth.role() <> 'mcp_import'
     or nullif(auth.jwt() ->> 'client_id', '') is null then
    raise exception 'mcp_oauth_required' using errcode = '42501';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception 'organization_access_denied' using errcode = '42501';
  end if;
  -- Serialize with changes to the organization switch, including its absent-row state.
  perform 1 from public.organizations where id = p_organization_id and deleted_at is null for share;
  if not found or not exists (
    select 1 from private.mcp_import_controls where organization_id = p_organization_id and enabled
  ) then
    raise exception 'mcp_import_unavailable' using errcode = '42501';
  end if;
  if p_source_file_name is null or length(p_source_file_name) > 255
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 100000
     or jsonb_typeof(p_payload -> 'meta') <> 'object'
     or jsonb_typeof(p_payload -> 'values') <> 'object'
     or jsonb_typeof(p_payload -> 'warnings') <> 'array'
     or coalesce(p_payload ->> 'confidence', '') not in ('high', 'medium', 'low')
     or (select count(*) from pg_catalog.jsonb_object_keys(p_payload -> 'values')) > 100
     or jsonb_array_length(p_payload -> 'warnings') > 50 then
    raise exception 'invalid_candidate_payload' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp_candidate:' || auth.uid()::text, 0));
  if (select count(*) from public.ai_import_candidates
      where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 50
     or (select count(*) from public.ai_import_candidates where created_by = auth.uid()) >= 100 then
    raise exception 'candidate_limit_reached' using errcode = '54000';
  end if;
  insert into public.ai_import_candidates (organization_id, created_by, source_file_name, payload)
  values (p_organization_id, auth.uid(), p_source_file_name, p_payload)
  returning id into v_id;
  return v_id;
end;
$$;
