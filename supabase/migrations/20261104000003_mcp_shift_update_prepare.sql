-- Internal preparation only. No MCP/application grant until the human
-- confirmation and execution flow is implemented and verified.
create function private.prepare_mcp_shift_update(
  p_organization_id uuid, p_shift_id uuid, p_start timestamptz,
  p_end timestamptz, p_segments jsonb
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_shift public.shifts%rowtype; v_before jsonb; v_refs jsonb; v_snapshot bytea; v_id uuid;
  v_segment jsonb; v_staff jsonb; v_start timestamptz; v_end timestamptz;
  v_staff_id uuid; v_role_id uuid; v_service_id uuid; v_seen uuid[];
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform private.assert_mcp_shift_read(p_organization_id);
  -- Keep permission and target checks consistent with the stored snapshot.
  perform 1 from public.organizations where id=p_organization_id and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles, public.organization_roles, public.assignments in share mode;
  lock table public.staffs, public.staff_roles, public.service_types, public.clients in share mode;
  lock table public.shifts, public.shift_segments, public.shift_segment_staffs, public.shift_staffs in share mode;
  perform private.assert_mcp_shift_read(p_organization_id);
  if private.get_member_shift_action_scope(p_organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p_organization_id,auth.uid(),'edit') is distinct from 'all'
    or not exists(select 1 from private.mcp_shift_update_controls where organization_id=p_organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p_organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into v_shift from public.shifts where id=p_shift_id and organization_id=p_organization_id
    and deleted_at is null and status is distinct from 'cancelled';
  if not found or not private.can_access_client(v_shift.client_id) or not private.can_access_shift(v_shift.id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '24 hours'
    or jsonb_typeof(p_segments) is distinct from 'array' then
    raise exception 'invalid_shift_proposal' using errcode='22023';
  end if;
  if jsonb_array_length(p_segments) not between 1 and 32 then
    raise exception 'invalid_shift_proposal' using errcode='22023';
  end if;
  for v_segment in select value from jsonb_array_elements(p_segments) loop
    if jsonb_typeof(v_segment) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(v_segment) k where k not in ('start_at','end_at','service_type_id','staffs'))
      or jsonb_typeof(v_segment->'start_at') is distinct from 'string'
      or jsonb_typeof(v_segment->'end_at') is distinct from 'string'
      or (v_segment->>'start_at') !~ '[Tt].*([Zz]|[+-][0-9]{2}:[0-9]{2})$'
      or (v_segment->>'end_at') !~ '[Tt].*([Zz]|[+-][0-9]{2}:[0-9]{2})$'
      or jsonb_typeof(v_segment->'staffs') is distinct from 'array'
      or (v_segment ? 'service_type_id' and jsonb_typeof(v_segment->'service_type_id') not in ('string','null')) then
      raise exception 'invalid_shift_proposal' using errcode='22023';
    end if;
    begin
      v_start := (v_segment->>'start_at')::timestamptz;
      v_end := (v_segment->>'end_at')::timestamptz;
      v_service_id := nullif(v_segment->>'service_type_id','')::uuid;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid_shift_proposal' using errcode='22023';
    end;
    if v_start is null or v_end is null or v_start<p_start or v_end>p_end or v_end<=v_start
      or jsonb_array_length(v_segment->'staffs') not between 1 and 20
      or (v_service_id is not null and not exists(select 1 from public.service_types where id=v_service_id and organization_id=p_organization_id and deleted_at is null)) then
      raise exception 'invalid_shift_proposal' using errcode='22023';
    end if;
    v_seen := array[]::uuid[];
    for v_staff in select value from jsonb_array_elements(v_segment->'staffs') loop
      if jsonb_typeof(v_staff) is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(v_staff) k where k not in ('staff_id','staff_role_id'))
        or jsonb_typeof(v_staff->'staff_id') is distinct from 'string'
        or (v_staff ? 'staff_role_id' and jsonb_typeof(v_staff->'staff_role_id') not in ('string','null')) then
        raise exception 'invalid_shift_proposal' using errcode='22023';
      end if;
      begin
        v_staff_id := (v_staff->>'staff_id')::uuid;
        v_role_id := nullif(v_staff->>'staff_role_id','')::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid_shift_proposal' using errcode='22023';
      end;
      if v_staff_id is null or v_staff_id=any(v_seen)
        or not exists(select 1 from public.staffs where id=v_staff_id and organization_id=p_organization_id and deleted_at is null and archived_at is null)
        or (v_role_id is not null and not exists(select 1 from public.staff_roles where id=v_role_id and organization_id=p_organization_id and deleted_at is null)) then
        raise exception 'invalid_shift_proposal' using errcode='22023';
      end if;
      v_seen := array_append(v_seen,v_staff_id);
    end loop;
  end loop;
  v_before := private.mcp_shift_update_before(p_organization_id,v_shift.id);
  v_snapshot := private.mcp_shift_change_snapshot(p_organization_id,p_shift_id);
  v_refs := private.mcp_shift_update_references(p_organization_id,p_shift_id,p_segments);
  if v_before is null or v_snapshot is null or not private.mcp_shift_update_references_available(v_refs) or not private.is_mcp_oauth_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp_shift_update:'||auth.uid()::text,0));
  if (select count(*) from private.mcp_shift_update_proposals where actor_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour')>=50 then
    raise exception 'proposal_limit' using errcode='54000';
  end if;
  if not private.is_mcp_oauth_active() then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  insert into private.mcp_shift_update_proposals(organization_id,actor_id,oauth_client_id,oauth_session_id,shift_id,original_snapshot,before_content,proposed_content,reference_content)
    values(p_organization_id,auth.uid(),(auth.jwt()->>'client_id')::uuid,(auth.jwt()->>'session_id')::uuid,p_shift_id,v_snapshot,v_before,
      jsonb_build_object('start_at',p_start,'end_at',p_end,'segments',p_segments),
      v_refs) returning id into v_id;
  return v_id;
end $$;
revoke all on function private.prepare_mcp_shift_update(uuid,uuid,timestamptz,timestamptz,jsonb)
  from public, anon, authenticated, service_role, mcp_import;
