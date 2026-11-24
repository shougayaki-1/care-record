-- MCP can poll only the initiating actor's proposal in the same active OAuth
-- connection; it cannot read the browser review or invoke confirmation.
create function public.get_mcp_master_edit_result(p_organization_id uuid,p_proposal uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare p private.mcp_master_edit_proposals%rowtype; v_current jsonb; v_org_name text;
begin
  if not private.is_mcp_oauth_active() or not private.is_org_member(p_organization_id)
    or not exists(select 1 from private.mcp_master_edit_controls where organization_id=p_organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p_organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into p from private.mcp_master_edit_proposals where id=p_proposal and organization_id=p_organization_id
    and actor_id=auth.uid() and oauth_client_id::text=auth.jwt()->>'client_id' and oauth_session_id::text=auth.jwt()->>'session_id';
  if not found or private.has_management_permission(p_organization_id,auth.uid(),case p.kind when 'client' then 'clients' else 'staffs' end) is distinct from true then return null; end if;
  select name into v_org_name from public.organizations where id=p.organization_id and deleted_at is null;
  if not found then return null; end if;
  if p.kind='client' then
    select jsonb_build_object('name',name) into v_current from public.clients where id=p.target_id and organization_id=p.organization_id and deleted_at is null and archived_at is null;
    if not found or not private.can_access_client(p.target_id) then return null; end if;
  else
    select jsonb_build_object('name',name,'employment_type',employment_type,'work_style',work_style) into v_current from public.staffs
      where id=p.target_id and organization_id=p.organization_id and deleted_at is null and archived_at is null;
    if not found then return null; end if;
  end if;
  if p.confirmed_at is not null then return jsonb_build_object('status','updated'); end if;
  if p.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if p.organization_name is distinct from v_org_name or p.before_content is distinct from v_current then return jsonb_build_object('status','changed'); end if;
  return jsonb_build_object('status','confirmation_required');
end $$;
revoke all on function public.get_mcp_master_edit_result(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_master_edit_result(uuid,uuid) to mcp_import;
notify pgrst, 'reload schema';
