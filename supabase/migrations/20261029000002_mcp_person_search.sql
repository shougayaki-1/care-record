-- MCP person search is disabled for every organization unless expressly enabled.
-- A manager must record the six required processing-condition checks before enablement.
-- Candidate submission controls remain separate.
create table private.mcp_person_search_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_person_search_controls enable row level security;
revoke all on table private.mcp_person_search_controls from public, anon, authenticated, service_role, mcp_import;

-- Only the existing integrations management permission can disable person searches.
-- Update and audit must commit together; if the audit fails the change rolls back.
create function public.disable_mcp_person_search(p_organization_id uuid)
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
  select enabled into v_before from private.mcp_person_search_controls where organization_id = p_organization_id;
  insert into private.mcp_person_search_controls (organization_id, enabled) values (p_organization_id, false)
    on conflict (organization_id) do update set enabled = false;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_person_search.disable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', false));
end $$;
revoke all on function public.disable_mcp_person_search(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.disable_mcp_person_search(uuid) to authenticated;

-- Conditions are manager attestations, not independent verification by this system.
-- Treat these fields as references or concise non-sensitive summaries, never record data or secrets.
create function public.enable_mcp_person_search(p_organization_id uuid, p_conditions jsonb)
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
  select enabled into v_before from private.mcp_person_search_controls where organization_id = p_organization_id;
  insert into private.mcp_person_search_controls (organization_id, enabled, conditions, confirmed_by, confirmed_at)
    values (p_organization_id, true, v_conditions, v_actor, v_now)
    on conflict (organization_id) do update set enabled = true, conditions = excluded.conditions,
      confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_person_search.enable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', true,
        'confirmedFields', jsonb_build_array('provider','processing','region','retention','secondary_use','notice'),
        'confirmedAt', v_now));
end $$;
revoke all on function public.enable_mcp_person_search(uuid,jsonb) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.enable_mcp_person_search(uuid,jsonb) to authenticated;

create function public.get_mcp_person_search_control(p_organization_id uuid)
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
    into v_result from private.mcp_person_search_controls where organization_id = p_organization_id;
  return coalesce(v_result, jsonb_build_object('enabled', false, 'conditions', null, 'confirmed_at', null));
end $$;
revoke all on function public.get_mcp_person_search_control(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_person_search_control(uuid) to authenticated;

-- Every search checks the live OAuth grant, organization and feature switch.
create function public.search_mcp_people(p_organization_id uuid, p_kind text, p_name text, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_mcp_oauth_active() or not private.is_org_member(p_organization_id) then
    raise exception 'mcp_person_search_unavailable' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = p_organization_id and deleted_at is null for share;
  if not found or not exists (select 1 from private.mcp_person_search_controls where organization_id = p_organization_id and enabled) then
    raise exception 'mcp_person_search_unavailable' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('client', 'staff') or p_name is null or length(btrim(p_name)) < 1 or length(p_name) > 100
     or p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'invalid_person_query' using errcode = '22023';
  end if;
  if p_kind = 'client' then
    select jsonb_build_object('people', coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'registered_date', q.registered_date) order by q.name, q.id) filter (where q.row_number <= p_offset + p_limit), '[]'::jsonb), 'has_more', count(*) > p_limit)
    into v_result from (select c.id, c.name, (c.created_at at time zone 'Asia/Tokyo')::date as registered_date, row_number() over (order by c.name, c.id) as row_number
      from public.clients c where c.organization_id = p_organization_id and c.deleted_at is null and c.archived_at is null
        and strpos(lower(c.name), lower(btrim(p_name))) > 0 and private.can_access_client(c.id)
      order by c.name, c.id offset p_offset limit p_limit + 1) q;
  else
    select jsonb_build_object('people', coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'registered_date', q.registered_date) order by q.name, q.id) filter (where q.row_number <= p_offset + p_limit), '[]'::jsonb), 'has_more', count(*) > p_limit)
    into v_result from (select s.id, s.name, (s.created_at at time zone 'Asia/Tokyo')::date as registered_date, row_number() over (order by s.name, s.id) as row_number
      from public.staffs s where s.organization_id = p_organization_id and s.deleted_at is null and s.archived_at is null
        and strpos(lower(s.name), lower(btrim(p_name))) > 0
      order by s.name, s.id offset p_offset limit p_limit + 1) q;
  end if;
  return v_result;
end $$;
revoke all on function public.search_mcp_people(uuid,text,text,integer,integer) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.search_mcp_people(uuid,text,text,integer,integer) to mcp_import;
