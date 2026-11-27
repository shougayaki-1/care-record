-- MCP shift read is disabled for every organization unless expressly enabled.
-- A manager must record the six required processing-condition checks before enablement.
-- Candidate submission controls remain separate.
create table private.mcp_shift_read_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_shift_read_controls enable row level security;
revoke all on table private.mcp_shift_read_controls from public, anon, authenticated, service_role, mcp_import;

-- Only the existing integrations management permission can disable shift reads.
-- Update and audit must commit together; if the audit fails the change rolls back.
create function public.disable_mcp_shift_read(p_organization_id uuid)
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
  select enabled into v_before from private.mcp_shift_read_controls where organization_id = p_organization_id;
  insert into private.mcp_shift_read_controls (organization_id, enabled) values (p_organization_id, false)
    on conflict (organization_id) do update set enabled = false;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_shift_read.disable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', false));
end $$;
revoke all on function public.disable_mcp_shift_read(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.disable_mcp_shift_read(uuid) to authenticated;

-- Conditions are manager attestations, not independent verification by this system.
-- Treat these fields as references or concise non-sensitive summaries, never record data or secrets.
create function public.enable_mcp_shift_read(p_organization_id uuid, p_conditions jsonb)
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
  select enabled into v_before from private.mcp_shift_read_controls where organization_id = p_organization_id;
  insert into private.mcp_shift_read_controls (organization_id, enabled, conditions, confirmed_by, confirmed_at)
    values (p_organization_id, true, v_conditions, v_actor, v_now)
    on conflict (organization_id) do update set enabled = true, conditions = excluded.conditions,
      confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_shift_read.enable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', true,
        'confirmedFields', jsonb_build_array('provider','processing','region','retention','secondary_use','notice'),
        'confirmedAt', v_now));
end $$;
revoke all on function public.enable_mcp_shift_read(uuid,jsonb) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.enable_mcp_shift_read(uuid,jsonb) to authenticated;

create function public.get_mcp_shift_read_control(p_organization_id uuid)
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
    into v_result from private.mcp_shift_read_controls where organization_id = p_organization_id;
  return coalesce(v_result, jsonb_build_object('enabled', false, 'conditions', null, 'confirmed_at', null));
end $$;
revoke all on function public.get_mcp_shift_read_control(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_shift_read_control(uuid) to authenticated;

-- The role has no table grants. Both entry points independently validate OAuth,
-- membership, the feature switch and the existing shift scope in the database.
create function private.assert_mcp_shift_read(p_org uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_mcp_oauth_active() or not private.is_org_member(p_org) then
    raise exception 'mcp_shift_read_unavailable' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = p_org and deleted_at is null for share;
  if not found or not exists (select 1 from private.mcp_shift_read_controls where organization_id = p_org and enabled)
     or private.get_member_shift_action_scope(p_org, auth.uid(), 'view') = 'none' then
    raise exception 'mcp_shift_read_unavailable' using errcode = '42501';
  end if;
end $$;
revoke all on function private.assert_mcp_shift_read(uuid) from public, anon, authenticated, service_role, mcp_import;

-- A tool-side preflight supplements, but never replaces, checks inside each read RPC.
create function public.check_mcp_shift_read(p_organization_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
 perform private.assert_mcp_shift_read(p_organization_id);
 return true;
end $$;
revoke all on function public.check_mcp_shift_read(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.check_mcp_shift_read(uuid) to mcp_import;

-- Only fields already present on the shift screen, plus segment and sync state.
-- Names of clients remain subject to their own existing access check.
create function private.mcp_shift_json(p_shift uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
  'id', s.id, 'organization_id', s.organization_id, 'client_id', s.client_id,
  'client_name', case when private.can_access_client(s.client_id) then c.name else null end,
  'title', s.title, 'start_at', s.start_at, 'end_at', s.end_at,
  'business_date', (s.start_at at time zone 'Asia/Tokyo')::date,
  'status', s.status, 'cancel_reason', s.cancel_reason, 'google_sync_status', s.google_sync_status,
  'report_statuses', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'is_primary', rs.is_primary) order by r.id)
    from public.report_shifts rs join public.reports r on r.id = rs.report_id
    where rs.shift_id = s.id and r.deleted_at is null and private.can_access_report(r.id)), '[]'::jsonb),
  'staffs', coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name) order by st.id)
    from public.shift_staffs ss join public.staffs st on st.id = ss.staff_id
    where ss.shift_id = s.id and st.organization_id = s.organization_id and st.deleted_at is null), '[]'::jsonb),
  'segments', coalesce((select jsonb_agg(jsonb_build_object('id', seg.id, 'service_type_id', seg.service_type_id,
    'start_at', seg.start_at, 'end_at', seg.end_at, 'sort_order', seg.sort_order,
    'staffs', coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name) order by st.id)
      from public.shift_segment_staffs sss join public.staffs st on st.id = sss.staff_id
      where sss.segment_id = seg.id and st.organization_id = s.organization_id and st.deleted_at is null), '[]'::jsonb))
    order by seg.sort_order, seg.id) from public.shift_segments seg where seg.shift_id = s.id), '[]'::jsonb))
 from public.shifts s left join public.clients c on c.id = s.client_id and c.organization_id = s.organization_id and c.deleted_at is null
 where s.id = p_shift and s.deleted_at is null and private.can_access_shift_row(s.id,s.organization_id,s.client_id,s.deleted_at)
$$;
revoke all on function private.mcp_shift_json(uuid) from public, anon, authenticated, service_role, mcp_import;

create function public.list_mcp_shifts(p_organization_id uuid, p_start date, p_end date,
 p_client_id uuid default null, p_staff_id uuid default null, p_unassigned boolean default false,
 p_sync_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
 perform private.assert_mcp_shift_read(p_organization_id);
 if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365
    or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000
    or p_unassigned is null or (p_unassigned and p_staff_id is not null)
    or (p_sync_status is not null and p_sync_status not in ('synced','pending_upsert','pending_delete','failed')) then
   raise exception 'invalid_shift_query' using errcode = '22023';
 end if;
 select jsonb_build_object('shifts', coalesce(jsonb_agg(private.mcp_shift_json(q.id) order by q.start_at, q.id), '[]'::jsonb),
    'has_more', count(*) > p_limit, 'limit', p_limit, 'offset', p_offset)
 into v_result from (
   select s.id, s.start_at from public.shifts s
   where s.organization_id = p_organization_id and s.deleted_at is null
     and s.start_at < ((p_end + 1)::timestamp at time zone 'Asia/Tokyo')
     and s.end_at > (p_start::timestamp at time zone 'Asia/Tokyo')
     and private.can_access_shift_row(s.id,s.organization_id,s.client_id,s.deleted_at)
     and (p_client_id is null or s.client_id = p_client_id)
     and (p_sync_status is null or s.google_sync_status = p_sync_status)
     and (p_staff_id is null or exists (select 1 from public.shift_staffs ss where ss.shift_id=s.id and ss.staff_id=p_staff_id)
       or exists (select 1 from public.shift_segments seg join public.shift_segment_staffs ss on ss.segment_id=seg.id where seg.shift_id=s.id and ss.staff_id=p_staff_id))
     and (not p_unassigned or (not exists (select 1 from public.shift_staffs ss where ss.shift_id=s.id)
       and not exists (select 1 from public.shift_segments seg join public.shift_segment_staffs ss on ss.segment_id=seg.id where seg.shift_id=s.id)))
   order by s.start_at, s.id limit p_limit + 1 offset p_offset
 ) q;
 -- Drop the look-ahead item; it only determines whether another page exists.
 if (v_result->>'has_more')::boolean then
   v_result := jsonb_set(v_result, '{shifts}', (v_result->'shifts') - p_limit);
 end if;
 return v_result;
end $$;
revoke all on function public.list_mcp_shifts(uuid,date,date,uuid,uuid,boolean,text,integer,integer) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.list_mcp_shifts(uuid,date,date,uuid,uuid,boolean,text,integer,integer) to mcp_import;

create function public.get_mcp_shift(p_organization_id uuid, p_shift_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
 perform private.assert_mcp_shift_read(p_organization_id);
 if not exists (select 1 from public.shifts where id=p_shift_id and organization_id=p_organization_id) then return null; end if;
 select private.mcp_shift_json(p_shift_id) into v_result;
 return v_result;
end $$;
revoke all on function public.get_mcp_shift(uuid,uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_shift(uuid,uuid) to mcp_import;
