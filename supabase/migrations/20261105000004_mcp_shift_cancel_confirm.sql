-- Internal primitive only. A future browser flow must show and explicitly
-- confirm the fixed proposal before invoking it; MCP cannot call it.
create function private.confirm_mcp_shift_cancel(p_proposal_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  p private.mcp_shift_cancel_proposals%rowtype; s public.shifts%rowtype;
  v_action text; v_years smallint; v_basis text; v_now timestamptz; v_deadline timestamptz; v_count integer;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  select * into p from private.mcp_shift_cancel_proposals where id=p_proposal_id and actor_id=auth.uid() for update;
  if not found or not private.mcp_shift_cancel_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  v_action := case p.operation when 'cancel' then 'edit' else 'delete' end;
  perform 1 from public.organizations where id=p.organization_id and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p.organization_id and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  perform 1 from public.user_session_activity where user_id=auth.uid() and auth_session_id=auth.jwt()->>'session_id'
    and revoked_at is null and last_activity>=clock_timestamp()-interval '24 hours' and absolute_expires_at>clock_timestamp() for share;
  if not found or not private.is_session_active() or not private.is_org_member(p.organization_id)
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),v_action) is distinct from 'all'
    or not exists(select 1 from private.mcp_shift_cancel_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_shift_read_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p.organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  lock table public.staffs,public.clients in share mode;
  lock table public.shifts,public.shift_segments,public.shift_segment_staffs,public.shift_staffs in share row exclusive mode;
  lock table public.reports,public.report_shifts in share mode;
  select * into s from public.shifts where id=p.shift_id and organization_id=p.organization_id;
  if not found or not private.can_access_client(s.client_id)
    or not private.is_session_active() or not private.mcp_shift_cancel_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if p.confirmed_at is not null then
    return jsonb_build_object('status','updated','operation',p.operation,'shift_id',p.shift_id,
      'organization_id',p.organization_id,'newly_updated',false);
  end if;
  if s.deleted_at is not null or not private.can_access_shift(s.id) then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  if p.expires_at<=clock_timestamp() then raise exception 'proposal_expired' using errcode='22023'; end if;
  if private.mcp_shift_cancel_snapshot(p.organization_id,p.shift_id) is distinct from p.original_snapshot
    or private.mcp_shift_cancel_references(p.organization_id,p.shift_id) is distinct from p.reference_content then
    raise exception 'proposal_changed' using errcode='22023';
  end if;
  if p.operation='cancel' then
    update public.shifts set status='cancelled',cancel_reason=p.reason,updated_at=clock_timestamp(),is_modified=true,
      google_sync_status='pending_upsert',google_sync_error=null,google_synced_at=null where id=s.id;
    insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,reason,details)
      values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','shift.cancel','shift',s.id::text,'success',p.reason,
        jsonb_build_object('source','mcp_confirmation','proposal_id',p.id));
  else
    select retention_years,legal_basis into v_years,v_basis from public.retention_policies
      where organization_id=p.organization_id and resource_type='shift' for share;
    if not found then raise exception 'retention_policy_required' using errcode='22023'; end if;
    v_now := clock_timestamp();
    v_deadline := ((v_now at time zone 'UTC') + make_interval(years=>v_years)) at time zone 'UTC';
    -- Match Date.setUTCFullYear on February 29 when the target year is not leap.
    if extract(month from v_now at time zone 'UTC')=2 and extract(day from v_now at time zone 'UTC')=29
      and extract(day from v_deadline at time zone 'UTC')=28 then v_deadline := v_deadline + interval '1 day'; end if;
    v_count := public.soft_delete_shifts_atomic(p.organization_id,array[s.id],p.reason,v_deadline,'pending_delete');
    if v_count<>1 then raise exception 'proposal_changed' using errcode='22023'; end if;
    insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,reason,details)
      values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','shift.bulk_soft_delete','shift',s.id::text,'success',p.reason,
        jsonb_build_object('source','mcp_confirmation','proposal_id',p.id,'shiftIds',jsonb_build_array(s.id),'count',1,'legalBasis',v_basis));
  end if;
  update private.mcp_shift_cancel_proposals set confirmed_at=clock_timestamp(),confirmed_session_id=auth.jwt()->>'session_id' where id=p.id;
  return jsonb_build_object('status','updated','operation',p.operation,'shift_id',s.id,
    'organization_id',p.organization_id,'newly_updated',true);
end $$;
revoke all on function private.confirm_mcp_shift_cancel(uuid) from public,anon,authenticated,service_role,mcp_import;
