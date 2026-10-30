-- Confirmation proposals are private and never grant the MCP role direct write access.
create table private.mcp_shift_create_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_shift_create_controls enable row level security;
revoke all on private.mcp_shift_create_controls from public, anon, authenticated, service_role, mcp_import;

create table private.mcp_shift_create_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  oauth_client_id uuid not null,
  oauth_session_id uuid not null,
  client_id uuid not null references public.clients(id),
  staff_id uuid not null references public.staffs(id),
  organization_name text not null,
  client_name text not null,
  staff_name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  shift_id uuid references public.shifts(id),
  confirmed_session_id text,
  confirmed_at timestamptz,
  check (end_at > start_at and end_at - start_at <= interval '24 hours'),
  check ((shift_id is null and confirmed_at is null and confirmed_session_id is null) or
         (shift_id is not null and confirmed_at is not null and confirmed_session_id is not null))
);
alter table private.mcp_shift_create_proposals enable row level security;
revoke all on private.mcp_shift_create_proposals from public, anon, authenticated, service_role, mcp_import;

create function public.get_mcp_shift_create_control(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_session_active() or not private.has_management_permission(p_organization_id,auth.uid(),'integrations') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  select jsonb_build_object('enabled',enabled,'conditions',conditions,'confirmed_at',confirmed_at) into result
    from private.mcp_shift_create_controls where organization_id=p_organization_id;
  return coalesce(result,jsonb_build_object('enabled',false,'conditions',null,'confirmed_at',null));
end $$;

create function public.set_mcp_shift_create_control(p_organization_id uuid,p_enabled boolean,p_conditions jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare k text; clean jsonb := '{}'::jsonb; previous boolean;
begin
  if auth.uid() is null or not private.is_session_active() or p_enabled is null then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_enabled then
    if jsonb_typeof(p_conditions) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_conditions)) <> 6 then raise exception 'invalid_conditions' using errcode='22023'; end if;
    foreach k in array array['provider','processing','region','retention','secondary_use','notice'] loop
      if jsonb_typeof(p_conditions->k) is distinct from 'string' or char_length(btrim(p_conditions->>k)) not between 1 and 500 then raise exception 'invalid_conditions' using errcode='22023'; end if;
      clean := clean || jsonb_build_object(k,btrim(p_conditions->>k));
    end loop;
  end if;
  perform 1 from public.organizations where id=p_organization_id and deleted_at is null for update;
  if not found or not private.is_session_active() or not private.has_management_permission(p_organization_id,auth.uid(),'integrations') then raise exception 'permission_denied' using errcode='42501'; end if;
  select enabled into previous from private.mcp_shift_create_controls where organization_id=p_organization_id;
  insert into private.mcp_shift_create_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at)
    values(p_organization_id,p_enabled,case when p_enabled then clean end,case when p_enabled then auth.uid() end,case when p_enabled then clock_timestamp() end)
    on conflict(organization_id) do update set enabled=excluded.enabled,conditions=excluded.conditions,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at;
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p_organization_id,auth.uid(),auth.jwt()->>'session_id','integration.mcp_shift_create.control','organization',p_organization_id::text,'success',jsonb_build_object('previouslyEnabled',coalesce(previous,false),'enabled',p_enabled));
end $$;

-- Confirm the original OAuth session and consent, including the reauthentication proof.
create function private.mcp_shift_create_oauth_valid(p_actor uuid,p_client uuid,p_session uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare granted timestamptz; verified timestamptz;
begin
  select granted_at into granted from auth.oauth_consents where user_id=p_actor and client_id=p_client and revoked_at is null for share;
  if granted is null then return false; end if;
  perform 1 from auth.sessions where id=p_session and user_id=p_actor and oauth_client_id=p_client and created_at<=clock_timestamp()
    and created_at+interval '30 days'>clock_timestamp() and (not_after is null or not_after>clock_timestamp()) for share;
  if not found then return false; end if;
  select verified_at into verified from private.mcp_reauth_proofs where user_id=p_actor and client_id=p_client and consent_granted_at=granted for share;
  return verified is not null and verified<=clock_timestamp() and verified+interval '30 days'>clock_timestamp()
    and exists(select 1 from auth.sessions where id=p_session and user_id=p_actor and oauth_client_id=p_client
      and created_at<=clock_timestamp() and created_at+interval '30 days'>clock_timestamp()
      and (not_after is null or not_after>clock_timestamp()));
end $$;
revoke all on function private.mcp_shift_create_oauth_valid(uuid,uuid,uuid) from public,anon,authenticated,service_role,mcp_import;

create function public.propose_mcp_shift_create(p_organization_id uuid,p_client_id uuid,p_staff_id uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proposal uuid; client_name text; staff_name text; organization_name text;
begin
  perform private.assert_mcp_shift_read(p_organization_id);
  if private.get_member_shift_action_scope(p_organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p_organization_id,auth.uid(),'create') is distinct from 'all'
    or not exists(select 1 from private.mcp_shift_create_controls where organization_id=p_organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p_organization_id and enabled) then
    raise exception 'mcp_shift_create_unavailable' using errcode='42501';
  end if;
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '24 hours' then raise exception 'invalid_shift_proposal' using errcode='22023'; end if;
  select name into client_name from public.clients where id=p_client_id and organization_id=p_organization_id and deleted_at is null and private.can_access_client(id);
  select name into staff_name from public.staffs where id=p_staff_id and organization_id=p_organization_id and deleted_at is null and archived_at is null;
  select name into organization_name from public.organizations where id=p_organization_id and deleted_at is null;
  if client_name is null or staff_name is null or organization_name is null then raise exception 'invalid_shift_proposal' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp_shift_create:'||auth.uid()::text,0));
  if (select count(*) from private.mcp_shift_create_proposals where actor_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour')>=50 then raise exception 'proposal_limit' using errcode='54000'; end if;
  if not private.is_mcp_oauth_active() then raise exception 'mcp_shift_create_unavailable' using errcode='42501'; end if;
  insert into private.mcp_shift_create_proposals(organization_id,actor_id,oauth_client_id,oauth_session_id,client_id,staff_id,organization_name,client_name,staff_name,start_at,end_at)
    values(p_organization_id,auth.uid(),(auth.jwt()->>'client_id')::uuid,(auth.jwt()->>'session_id')::uuid,p_client_id,p_staff_id,organization_name,client_name,staff_name,p_start,p_end) returning id into proposal;
  return jsonb_build_object('proposal_id',proposal,'client_name',client_name,'staff_name',staff_name,'start_at',p_start,'end_at',p_end,'status','confirmation_required','expires_in_seconds',600);
end $$;

create function public.get_mcp_shift_create_proposal(p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.mcp_shift_create_proposals%rowtype; result jsonb;
begin
  if auth.uid() is null or not private.is_session_active() then raise exception 'permission_denied' using errcode='42501'; end if;
  select * into p from private.mcp_shift_create_proposals where id=p_proposal_id and actor_id=auth.uid();
  if not found or not private.is_org_member(p.organization_id)
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),'create') is distinct from 'all'
    or not private.can_access_client(p.client_id)
    or not exists(select 1 from private.mcp_shift_create_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_shift_read_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p.organization_id and enabled)
    or not private.mcp_shift_create_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then return null; end if;
  select jsonb_build_object('proposal_id',p.id,'organization_name',p.organization_name,'client_name',p.client_name,'staff_name',p.staff_name,'start_at',p.start_at,'end_at',p.end_at,'expires_at',p.expires_at,'status',case when p.shift_id is not null then 'created' when p.expires_at<=clock_timestamp() then 'expired' else 'confirmation_required' end,'shift_id',p.shift_id)
    into result from public.organizations o join public.clients c on c.id=p.client_id and c.organization_id=o.id join public.staffs s on s.id=p.staff_id and s.organization_id=o.id where o.id=p.organization_id;
  return result;
end $$;

-- Human confirmation and creation occur together under the browser session.
create function public.confirm_mcp_shift_create(p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.mcp_shift_create_proposals%rowtype; v_shift uuid; v_client text; v_staff text; result jsonb;
begin
  if auth.uid() is null or not private.is_session_active() then raise exception 'permission_denied' using errcode='42501'; end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  select * into p from private.mcp_shift_create_proposals where id=p_proposal_id and actor_id=auth.uid() for update;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  if not private.mcp_shift_create_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organizations where id=p.organization_id and deleted_at is null and name=p.organization_name for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p.organization_id and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  perform 1 from public.user_session_activity where user_id=auth.uid() and auth_session_id=auth.jwt()->>'session_id' and revoked_at is null and last_activity>=clock_timestamp()-interval '24 hours' and absolute_expires_at>clock_timestamp() for share;
  if not found or not private.is_org_member(p.organization_id) or not private.is_session_active()
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),'create') is distinct from 'all'
    or not private.can_access_client(p.client_id)
    or not exists(select 1 from private.mcp_shift_create_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_shift_read_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p.organization_id and enabled) then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  if p.shift_id is not null then
    select jsonb_build_object('status','created','shift_id',id,'organization_id',organization_id,'google_sync_status',google_sync_status,'newly_created',false) into result from public.shifts where id=p.shift_id and organization_id=p.organization_id;
    return result;
  end if;
  if p.expires_at<=clock_timestamp() then raise exception 'proposal_expired' using errcode='22023'; end if;
  select name into v_client from public.clients where id=p.client_id and organization_id=p.organization_id and deleted_at is null and private.can_access_client(id) for share;
  select name into v_staff from public.staffs where id=p.staff_id and organization_id=p.organization_id and deleted_at is null and archived_at is null for share;
  if v_client is distinct from p.client_name or v_staff is distinct from p.staff_name then raise exception 'proposal_changed' using errcode='22023'; end if;
  -- Serialize the check with every existing write path, including ordinary app writes.
  lock table public.shifts,public.shift_segments,public.shift_segment_staffs,public.shift_staffs in share row exclusive mode;
  if p.expires_at<=clock_timestamp() or not exists(select 1 from public.user_session_activity where user_id=auth.uid() and auth_session_id=auth.jwt()->>'session_id' and revoked_at is null and last_activity>=clock_timestamp()-interval '24 hours' and absolute_expires_at>clock_timestamp()) or not private.mcp_shift_create_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then raise exception 'proposal_expired' using errcode='22023'; end if;
  if exists(select 1 from public.shifts s where s.organization_id=p.organization_id and s.deleted_at is null and s.status is distinct from 'cancelled'
    and ((s.client_id=p.client_id and s.start_at<p.end_at and s.end_at>p.start_at)
      or (s.start_at<p.end_at and s.end_at>p.start_at and exists(select 1 from public.shift_staffs x where x.shift_id=s.id and x.staff_id=p.staff_id) and not exists(select 1 from public.shift_segments x join public.shift_segment_staffs y on y.segment_id=x.id where x.shift_id=s.id and y.staff_id=p.staff_id))
      or exists(select 1 from public.shift_segments x join public.shift_segment_staffs y on y.segment_id=x.id where x.shift_id=s.id and y.staff_id=p.staff_id and x.start_at<p.end_at and x.end_at>p.start_at))) then
    raise exception 'shift_conflict' using errcode='23505';
  end if;
  v_shift := public.create_shift_with_segments_atomic(p.organization_id,jsonb_build_object('client_id',p.client_id,'title',v_client||' ('||btrim(v_staff)||')','start_at',p.start_at,'end_at',p.end_at,'status','published','segments',jsonb_build_array(jsonb_build_object('start_at',p.start_at,'end_at',p.end_at,'staffs',jsonb_build_array(jsonb_build_object('staff_id',p.staff_id))))));
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','shift.create','shift',v_shift::text,'success',jsonb_build_object('source','mcp_confirmation','proposal_id',p.id));
  update private.mcp_shift_create_proposals set shift_id=v_shift,confirmed_at=clock_timestamp(),confirmed_session_id=auth.jwt()->>'session_id' where id=p.id;
  return jsonb_build_object('status','created','shift_id',v_shift,'organization_id',p.organization_id,'google_sync_status','pending_upsert','newly_created',true);
end $$;

create function public.get_mcp_shift_create_result(p_organization_id uuid,p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.mcp_shift_create_proposals%rowtype; result jsonb;
begin
  perform private.assert_mcp_shift_read(p_organization_id);
  select * into p from private.mcp_shift_create_proposals where id=p_proposal_id and organization_id=p_organization_id and actor_id=auth.uid() and oauth_client_id::text=auth.jwt()->>'client_id' and oauth_session_id::text=auth.jwt()->>'session_id';
  if not found or not exists(select 1 from private.mcp_shift_create_controls where organization_id=p_organization_id and enabled)
    or private.get_member_shift_action_scope(p_organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p_organization_id,auth.uid(),'create') is distinct from 'all'
    or not private.can_access_client(p.client_id) then return null; end if;
  if p.shift_id is null then return jsonb_build_object('status',case when p.expires_at<=clock_timestamp() then 'expired' else 'confirmation_required' end); end if;
  select jsonb_build_object('status','created','shift_id',id,'google_sync_status',google_sync_status) into result from public.shifts where id=p.shift_id and organization_id=p.organization_id;
  return result;
end $$;

revoke all on function public.get_mcp_shift_create_control(uuid),public.set_mcp_shift_create_control(uuid,boolean,jsonb),public.get_mcp_shift_create_proposal(uuid),public.confirm_mcp_shift_create(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_shift_create_control(uuid),public.set_mcp_shift_create_control(uuid,boolean,jsonb),public.get_mcp_shift_create_proposal(uuid),public.confirm_mcp_shift_create(uuid) to authenticated;
revoke all on function public.propose_mcp_shift_create(uuid,uuid,uuid,timestamptz,timestamptz),public.get_mcp_shift_create_result(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.propose_mcp_shift_create(uuid,uuid,uuid,timestamptz,timestamptz),public.get_mcp_shift_create_result(uuid,uuid) to mcp_import;
notify pgrst, 'reload schema';
