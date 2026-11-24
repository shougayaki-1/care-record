-- Internal browser confirmation. Write, audit and proposal consumption share a
-- transaction; a failed audit or stale snapshot leaves the master unchanged.
create function private.confirm_mcp_master_edit(p_proposal uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  p private.mcp_master_edit_proposals%rowtype; v_client public.clients%rowtype; v_staff public.staffs%rowtype;
  v_org_name text; v_current jsonb; v_action text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  select * into p from private.mcp_master_edit_proposals where id=p_proposal and actor_id=auth.uid() for update;
  if not found or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select name into v_org_name from public.organizations where id=p.organization_id and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p.organization_id and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles in share mode;
  perform 1 from public.user_session_activity where user_id=auth.uid() and auth_session_id=auth.jwt()->>'session_id'
    and revoked_at is null and last_activity>=clock_timestamp()-interval '24 hours' and absolute_expires_at>clock_timestamp() for share;
  if not found or not private.is_session_active() or not private.is_org_member(p.organization_id)
    or private.has_management_permission(p.organization_id,auth.uid(),case p.kind when 'client' then 'clients' else 'staffs' end) is distinct from true
    or not exists(select 1 from private.mcp_master_edit_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p.organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if p.kind='client' then
    select * into v_client from public.clients where id=p.target_id and organization_id=p.organization_id and deleted_at is null and archived_at is null for update;
    if not found or not private.can_access_client(p.target_id) then raise exception 'proposal_unavailable' using errcode='42501'; end if;
    v_current := jsonb_build_object('name',v_client.name);
  else
    select * into v_staff from public.staffs where id=p.target_id and organization_id=p.organization_id and deleted_at is null and archived_at is null for update;
    if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
    v_current := jsonb_build_object('name',v_staff.name,'employment_type',v_staff.employment_type,'work_style',v_staff.work_style);
  end if;
  if not private.is_session_active() or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if p.confirmed_at is not null then return jsonb_build_object('status','updated','newly_updated',false); end if;
  if p.expires_at<=clock_timestamp() then raise exception 'proposal_expired' using errcode='22023'; end if;
  if v_org_name is distinct from p.organization_name or v_current is distinct from p.before_content then
    raise exception 'proposal_changed' using errcode='22023';
  end if;
  if p.kind='client' then
    update public.clients set name=p.proposed_content->>'name' where id=p.target_id and organization_id=p.organization_id;
    v_action := 'client.rename';
  else
    update public.staffs set name=p.proposed_content->>'name', employment_type=p.proposed_content->>'employment_type',
      work_style=p.proposed_content->>'work_style' where id=p.target_id and organization_id=p.organization_id;
    v_action := 'staff.update';
  end if;
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p.organization_id,auth.uid(),auth.jwt()->>'session_id',v_action,p.kind,p.target_id::text,'success',
      jsonb_build_object('source','mcp_confirmation','proposal_id',p.id));
  update private.mcp_master_edit_proposals set confirmed_at=clock_timestamp(),confirmed_session_id=auth.jwt()->>'session_id' where id=p.id;
  return jsonb_build_object('status','updated','newly_updated',true);
end $$;
revoke all on function private.confirm_mcp_master_edit(uuid) from public,anon,authenticated,service_role,mcp_import;
