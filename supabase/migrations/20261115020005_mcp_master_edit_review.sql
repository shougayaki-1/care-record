-- Browser-only review: return frozen fields only after reauthorizing the owner.
create function public.get_mcp_master_edit_review(p_proposal uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare p private.mcp_master_edit_proposals%rowtype; v_current jsonb; v_org_name text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into p from private.mcp_master_edit_proposals where id=p_proposal and actor_id=auth.uid();
  if not found or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id)
    or not private.is_org_member(p.organization_id)
    or private.has_management_permission(p.organization_id,auth.uid(),case p.kind when 'client' then 'clients' else 'staffs' end) is distinct from true
    or not exists(select 1 from private.mcp_master_edit_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p.organization_id and enabled) then return null; end if;
  select name into v_org_name from public.organizations where id=p.organization_id and deleted_at is null;
  if not found then return null; end if;
  if p.kind='client' then
    select jsonb_build_object('name',name) into v_current from public.clients
      where id=p.target_id and organization_id=p.organization_id and deleted_at is null and archived_at is null;
    if not found or not private.can_access_client(p.target_id) then return null; end if;
  else
    select jsonb_build_object('name',name,'employment_type',employment_type,'work_style',work_style) into v_current from public.staffs
      where id=p.target_id and organization_id=p.organization_id and deleted_at is null and archived_at is null;
    if not found then return null; end if;
  end if;
  if p.confirmed_at is not null then return jsonb_build_object('status','updated'); end if;
  if p.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if p.organization_name is distinct from v_org_name or p.before_content is distinct from v_current then return jsonb_build_object('status','changed'); end if;
  return jsonb_build_object('status','confirmation_required','proposal_id',p.id,'target_id',p.target_id,'kind',p.kind,'organization_name',p.organization_name,
    'before',p.before_content,'proposal',p.proposed_content,'expires_at',p.expires_at);
end $$;
revoke all on function public.get_mcp_master_edit_review(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_master_edit_review(uuid) to authenticated;

create function public.confirm_mcp_master_edit(p_proposal uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.confirm_mcp_master_edit(p_proposal)
$$;
revoke all on function public.confirm_mcp_master_edit(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.confirm_mcp_master_edit(uuid) to authenticated;

create function public.prepare_mcp_master_edit(p_organization_id uuid,p_kind text,p_target_id uuid,p_changes jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_expires timestamptz;
begin
  v_id := private.prepare_mcp_master_edit(p_organization_id,p_kind,p_target_id,p_changes);
  select expires_at into v_expires from private.mcp_master_edit_proposals where id=v_id and actor_id=auth.uid();
  return jsonb_build_object('status','confirmation_required','proposal_id',v_id,'expires_at',v_expires);
end $$;
revoke all on function public.prepare_mcp_master_edit(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.prepare_mcp_master_edit(uuid,text,uuid,jsonb) to mcp_import;
notify pgrst, 'reload schema';
