-- MCP record read is disabled for every organization unless expressly enabled.
-- A manager must record the six required processing-condition checks before enablement.
-- Candidate submission controls remain separate.
create table private.mcp_record_read_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_record_read_controls enable row level security;
revoke all on table private.mcp_record_read_controls from public, anon, authenticated, service_role, mcp_import;

-- Only the existing integrations management permission can disable record reads.
-- Update and audit must commit together; if the audit fails the change rolls back.
create function public.disable_mcp_record_read(p_organization_id uuid)
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
  select enabled into v_before from private.mcp_record_read_controls where organization_id = p_organization_id;
  insert into private.mcp_record_read_controls (organization_id, enabled) values (p_organization_id, false)
    on conflict (organization_id) do update set enabled = false;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_record_read.disable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', false));
end $$;
revoke all on function public.disable_mcp_record_read(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.disable_mcp_record_read(uuid) to authenticated;

-- Conditions are manager attestations, not independent verification by this system.
-- Treat these fields as references or concise non-sensitive summaries, never record data or secrets.
create function public.enable_mcp_record_read(p_organization_id uuid, p_conditions jsonb)
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
  select enabled into v_before from private.mcp_record_read_controls where organization_id = p_organization_id;
  insert into private.mcp_record_read_controls (organization_id, enabled, conditions, confirmed_by, confirmed_at)
    values (p_organization_id, true, v_conditions, v_actor, v_now)
    on conflict (organization_id) do update set enabled = true, conditions = excluded.conditions,
      confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at;
  insert into public.audit_events (organization_id, actor_id, session_id, action_type, resource_type, resource_id, outcome, details)
    values (p_organization_id, v_actor, auth.jwt()->>'session_id', 'integration.mcp_record_read.enable',
      'organization', p_organization_id::text, 'success',
      jsonb_build_object('previouslyEnabled', coalesce(v_before, false), 'enabled', true,
        'confirmedFields', jsonb_build_array('provider','processing','region','retention','secondary_use','notice'),
        'confirmedAt', v_now));
end $$;
revoke all on function public.enable_mcp_record_read(uuid,jsonb) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.enable_mcp_record_read(uuid,jsonb) to authenticated;

create function public.get_mcp_record_read_control(p_organization_id uuid)
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
    into v_result from private.mcp_record_read_controls where organization_id = p_organization_id;
  return coalesce(v_result, jsonb_build_object('enabled', false, 'conditions', null, 'confirmed_at', null));
end $$;
revoke all on function public.get_mcp_record_read_control(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_record_read_control(uuid) to authenticated;


create function private.assert_mcp_record_read(p_org uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_mcp_oauth_active() or not private.is_org_member(p_org) then
    raise exception 'mcp_record_read_unavailable' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = p_org and deleted_at is null for share;
  if not found or not exists (select 1 from private.mcp_record_read_controls where organization_id = p_org and enabled)
     or private.get_member_record_view_scope(p_org, auth.uid()) = 'none' then
    raise exception 'mcp_record_read_unavailable' using errcode = '42501';
  end if;
end $$;
revoke all on function private.assert_mcp_record_read(uuid) from public, anon, authenticated, service_role, mcp_import;

create function public.list_mcp_records(p_organization_id uuid, p_start date, p_end date,
 p_client_id uuid default null, p_staff_id uuid default null, p_status text default null,
 p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
 perform private.assert_mcp_record_read(p_organization_id);
 if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365
   or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000
   or (p_status is not null and p_status not in ('draft','pending','approved','remanded')) then
   raise exception 'invalid_record_query' using errcode = '22023';
 end if;
 select jsonb_build_object('records', coalesce(jsonb_agg(jsonb_build_object(
   'id', q.id, 'client_id', q.client_id, 'helper_id', q.helper_id, 'service_date', q.service_date,
   'start_at', q.start_at, 'end_at', q.end_at, 'status', q.status,
   'current_version', q.current_version, 'current_revision_id', q.current_revision_id,
   'approved_at', q.approved_at) order by q.service_date desc, q.id), '[]'::jsonb),
   'has_more', count(*) > p_limit, 'limit', p_limit, 'offset', p_offset)
 into v_result from (
   select r.* from public.reports r join public.clients c on c.id=r.client_id
   where c.organization_id=p_organization_id and r.deleted_at is null and private.can_access_report(r.id)
     and r.service_date between p_start and p_end
     and (p_client_id is null or r.client_id=p_client_id)
     and (p_staff_id is null or exists (select 1 from public.staffs st where st.id=p_staff_id and st.organization_id=p_organization_id and st.user_id=r.helper_id) or exists
       (select 1 from public.report_actual_staffs ras where ras.report_id=r.id and ras.staff_id=p_staff_id))
     and (p_status is null or r.status=p_status)
   order by r.service_date desc, r.id limit p_limit+1 offset p_offset
 ) q;
 if (v_result->>'has_more')::boolean then v_result := jsonb_set(v_result, '{records}', (v_result->'records') - p_limit); end if;
 return v_result;
end $$;
revoke all on function public.list_mcp_records(uuid,date,date,uuid,uuid,text,integer,integer) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.list_mcp_records(uuid,date,date,uuid,uuid,text,integer,integer) to mcp_import;

create function public.get_mcp_record(p_organization_id uuid, p_record_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
 perform private.assert_mcp_record_read(p_organization_id);
 select jsonb_build_object('id',r.id,'client_id',r.client_id,'helper_id',r.helper_id,
   'service_date',r.service_date,'start_at',r.start_at,'end_at',r.end_at,'status',r.status,
   'approved_at',r.approved_at,'current_version',r.current_version,'current_revision_id',r.current_revision_id,
   'values',rv.data,'attachment_count',(select count(*) from public.report_images i where i.report_id=r.id))
 into v_result from public.reports r join public.clients c on c.id=r.client_id
 left join public.report_values rv on rv.report_id=r.id
 where r.id=p_record_id and c.organization_id=p_organization_id and r.deleted_at is null and private.can_access_report(r.id);
 return v_result;
end $$;
revoke all on function public.get_mcp_record(uuid,uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_record(uuid,uuid) to mcp_import;
