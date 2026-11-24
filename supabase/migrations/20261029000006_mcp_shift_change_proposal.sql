-- A proposal is read-only and requires complete visibility to detect conflicts.
create function public.propose_mcp_shift_change(p_organization_id uuid, p_shift_id uuid, p_staff_id uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_shift public.shifts%rowtype; v_before jsonb; v_overlap boolean; v_assigned boolean;
begin
  perform private.assert_mcp_shift_read(p_organization_id);
  if private.get_member_shift_action_scope(p_organization_id, auth.uid(), 'view') is distinct from 'all'
     or not exists (select 1 from private.mcp_person_search_controls where organization_id=p_organization_id and enabled) then
    raise exception 'mcp_shift_read_unavailable' using errcode='42501';
  end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > interval '24 hours'
     or p_staff_id is null or not exists (select 1 from public.staffs where id=p_staff_id and organization_id=p_organization_id and deleted_at is null and archived_at is null) then
    raise exception 'invalid_shift_proposal' using errcode='22023';
  end if;
  select * into v_shift from public.shifts where id=p_shift_id and organization_id=p_organization_id and deleted_at is null and status is distinct from 'cancelled';
  if not found then return null; end if;
  v_before := private.mcp_shift_json(v_shift.id);
  if v_before is null then return null; end if;
  select exists (select 1 from public.shifts s where s.organization_id=p_organization_id and s.id<>p_shift_id and s.deleted_at is null and s.status is distinct from 'cancelled'
    and ((s.start_at < p_end and s.end_at > p_start and exists (select 1 from public.shift_staffs ss where ss.shift_id=s.id and ss.staff_id=p_staff_id)
      and not exists (select 1 from public.shift_segments x join public.shift_segment_staffs xs on xs.segment_id=x.id where x.shift_id=s.id and xs.staff_id=p_staff_id))
      or exists (select 1 from public.shift_segments seg join public.shift_segment_staffs ss on ss.segment_id=seg.id where seg.shift_id=s.id and ss.staff_id=p_staff_id and seg.start_at < p_end and seg.end_at > p_start))) into v_overlap;
  v_assigned := case when v_shift.client_id is null then null else exists (select 1 from public.assignments a where a.client_id=v_shift.client_id and a.staff_id=p_staff_id) end;
  return jsonb_build_object('shift_id',p_shift_id,'before',v_before,
    'proposal',jsonb_build_object('start_at',p_start,'end_at',p_end,'staff_id',p_staff_id),
    'overlap',v_overlap,'assigned_to_client',v_assigned,
    'status',case when v_overlap then 'overlap' else 'needs_confirmation' end,
    'unverified',jsonb_build_array('勤務予定・休暇','移動時間','資格・サービス要件','担当条件の適合性','他の担当者とサービス区間への影響','確定時の再確認'));
end $$;
revoke all on function public.propose_mcp_shift_change(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.propose_mcp_shift_change(uuid,uuid,uuid,timestamptz,timestamptz) to mcp_import;
