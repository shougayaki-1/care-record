-- Internal confirmation primitive. It must not be exposed until a human-facing
-- review flow binds the displayed target identities and contents to this call.
create function private.confirm_mcp_shift_update(p_proposal_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  p private.mcp_shift_update_proposals%rowtype; s public.shifts%rowtype;
  v_segment jsonb; v_staff jsonb; v_start timestamptz; v_end timestamptz;
  v_staff_id uuid; v_role_id uuid; v_service_id uuid; v_result jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  select * into p from private.mcp_shift_update_proposals where id=p_proposal_id and actor_id=auth.uid() for update;
  if not found or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  perform 1 from public.organizations where id=p.organization_id and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p.organization_id and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  perform 1 from public.user_session_activity where user_id=auth.uid() and auth_session_id=auth.jwt()->>'session_id'
    and revoked_at is null and last_activity>=clock_timestamp()-interval '24 hours' and absolute_expires_at>clock_timestamp() for share;
  if not found or not private.is_session_active() or not private.is_org_member(p.organization_id)
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),'edit') is distinct from 'all'
    or not exists(select 1 from private.mcp_shift_update_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_shift_read_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p.organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  -- Serialize conflict checks with ordinary shift edits, including child rows.
  lock table public.staffs,public.staff_roles,public.service_types,public.clients in share mode;
  lock table public.shifts,public.shift_segments,public.shift_segment_staffs,public.shift_staffs in share row exclusive mode;
  select * into s from public.shifts where id=p.shift_id and organization_id=p.organization_id and deleted_at is null;
  if not found or s.status='cancelled' or not private.can_access_shift(s.id) or not private.can_access_client(s.client_id)
    or not private.is_session_active() or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if p.confirmed_at is not null then
    return jsonb_build_object('status','updated','shift_id',s.id,'organization_id',s.organization_id,
      'google_sync_status',s.google_sync_status,'newly_updated',false);
  end if;
  if p.expires_at<=clock_timestamp() then raise exception 'proposal_expired' using errcode='22023'; end if;
  if private.mcp_shift_change_snapshot(p.organization_id,p.shift_id) is distinct from p.original_snapshot
    or private.mcp_shift_update_references(p.organization_id,p.shift_id,p.proposed_content->'segments') is distinct from p.reference_content then
    raise exception 'proposal_changed' using errcode='22023';
  end if;
  v_start := (p.proposed_content->>'start_at')::timestamptz;
  v_end := (p.proposed_content->>'end_at')::timestamptz;
  if exists(select 1 from public.shifts x where x.organization_id=p.organization_id and x.id<>p.shift_id
    and x.deleted_at is null and x.status is distinct from 'cancelled' and x.client_id=s.client_id
    and x.start_at<v_end and x.end_at>v_start) then
    raise exception 'shift_conflict' using errcode='23505';
  end if;
  for v_segment in select value from jsonb_array_elements(p.proposed_content->'segments') loop
    v_start := (v_segment->>'start_at')::timestamptz;
    v_end := (v_segment->>'end_at')::timestamptz;
    v_service_id := nullif(v_segment->>'service_type_id','')::uuid;
    if v_service_id is not null and not exists(select 1 from public.service_types where id=v_service_id and organization_id=p.organization_id and deleted_at is null) then
      raise exception 'proposal_changed' using errcode='22023';
    end if;
    for v_staff in select value from jsonb_array_elements(v_segment->'staffs') loop
      v_staff_id := (v_staff->>'staff_id')::uuid;
      v_role_id := nullif(v_staff->>'staff_role_id','')::uuid;
      if not exists(select 1 from public.staffs where id=v_staff_id and organization_id=p.organization_id and deleted_at is null and archived_at is null)
        or (v_role_id is not null and not exists(select 1 from public.staff_roles where id=v_role_id and organization_id=p.organization_id and deleted_at is null)) then
        raise exception 'proposal_changed' using errcode='22023';
      end if;
      if exists(select 1 from public.shifts x where x.organization_id=p.organization_id and x.id<>p.shift_id
        and x.deleted_at is null and x.status is distinct from 'cancelled'
        and ((x.start_at<v_end and x.end_at>v_start and exists(select 1 from public.shift_staffs xs where xs.shift_id=x.id and xs.staff_id=v_staff_id)
          and not exists(select 1 from public.shift_segments t join public.shift_segment_staffs ts on ts.segment_id=t.id where t.shift_id=x.id and ts.staff_id=v_staff_id))
          or exists(select 1 from public.shift_segments t join public.shift_segment_staffs ts on ts.segment_id=t.id
            where t.shift_id=x.id and ts.staff_id=v_staff_id and t.start_at<v_end and t.end_at>v_start))) then
        raise exception 'shift_conflict' using errcode='23505';
      end if;
    end loop;
  end loop;
  if p.expires_at<=clock_timestamp() or not private.is_session_active()
    or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_expired' using errcode='22023';
  end if;
  perform public.update_shift_with_segments_atomic(p.organization_id,p.shift_id,
    jsonb_build_object('start_at',p.proposed_content->>'start_at','end_at',p.proposed_content->>'end_at','is_modified',true),
    p.proposed_content->'segments');
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','shift.update','shift',p.shift_id::text,'success',
      jsonb_build_object('source','mcp_confirmation','proposal_id',p.id,'fields',jsonb_build_array('start_at','end_at','segments')));
  update private.mcp_shift_update_proposals set confirmed_at=clock_timestamp(),confirmed_session_id=auth.jwt()->>'session_id' where id=p.id;
  select jsonb_build_object('status','updated','shift_id',id,'organization_id',organization_id,
    'google_sync_status',google_sync_status,'newly_updated',true) into v_result from public.shifts where id=p.shift_id;
  return v_result;
end $$;
revoke all on function private.confirm_mcp_shift_update(uuid) from public,anon,authenticated,service_role,mcp_import;
