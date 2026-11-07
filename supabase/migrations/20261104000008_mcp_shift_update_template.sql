-- Expose the full current segments/roles needed to construct a deliberate
-- replacement. A deleted or missing identity is never disclosed.
create function public.get_mcp_shift_update_template(p_organization_id uuid,p_shift_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s public.shifts%rowtype; v_before jsonb; v_refs jsonb; v_draft jsonb;
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform private.assert_mcp_shift_read(p_organization_id);
  perform 1 from public.organizations where id=p_organization_id and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  lock table public.staffs,public.staff_roles,public.service_types,public.clients in share mode;
  lock table public.shifts,public.shift_segments,public.shift_segment_staffs,public.shift_staffs in share mode;
  perform private.assert_mcp_shift_read(p_organization_id);
  if private.get_member_shift_action_scope(p_organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p_organization_id,auth.uid(),'edit') is distinct from 'all'
    or not exists(select 1 from private.mcp_shift_update_controls where organization_id=p_organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p_organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into s from public.shifts where id=p_shift_id and organization_id=p_organization_id
    and deleted_at is null and status is distinct from 'cancelled';
  if not found or not private.can_access_shift(s.id) or not private.can_access_client(s.client_id) then return null; end if;
  if (select count(*) from public.shift_staffs where shift_id=s.id)>640
    or (select count(*) from public.shift_segments where shift_id=s.id)>32
    or exists(select 1 from public.shift_segments t where t.shift_id=s.id and
      (select count(*) from public.shift_segment_staffs x where x.segment_id=t.id)>20) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  v_before := private.mcp_shift_update_before(p_organization_id,s.id);
  v_refs := private.mcp_shift_update_references(p_organization_id,s.id,'[]'::jsonb);
  if v_before is null or not private.mcp_shift_update_references_available(v_refs) or not private.is_mcp_oauth_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('start_at',t.value->'start_at','end_at',t.value->'end_at',
    'service_type_id',t.value->'service_type_id','staffs',t.value->'staffs') order by t.ordinal),'[]'::jsonb)
    into v_draft from jsonb_array_elements(v_before->'segments') with ordinality as t(value,ordinal);
  return jsonb_build_object('shift',v_before,'references',v_refs,'draft_segments',v_draft,
    'notice',jsonb_build_array('draft_segments を基に、変更後の全区間を含めてください。担当のない区間や区間のないシフトは本人に内容を確認してください。',
      '変更確定時に既存の区間と元パターンの関連は解除されます。',
      '記録に使われた区間は既存の業務ルールに従って変更できません。'));
end $$;
revoke all on function public.get_mcp_shift_update_template(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_shift_update_template(uuid,uuid) to mcp_import;
notify pgrst, 'reload schema';
