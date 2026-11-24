-- Create a fixed, narrowly scoped proposal; no write to clients or staffs.
create function private.prepare_mcp_master_edit(p_org uuid,p_kind text,p_target uuid,p_changes jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_before jsonb; v_after jsonb; v_org_name text; v_id uuid; v_name text;
  v_client public.clients%rowtype; v_staff public.staffs%rowtype;
begin
  if p_kind not in ('client','staff') or p_kind is null or p_org is null or p_target is null
    or jsonb_typeof(p_changes) is distinct from 'object' or p_changes='{}'::jsonb
    or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('name','employment_type','work_style'))
    or (p_kind='client' and (p_changes ? 'employment_type' or p_changes ? 'work_style')) then
    raise exception 'invalid_master_proposal' using errcode='22023';
  end if;
  if p_changes ? 'name' then
    if jsonb_typeof(p_changes->'name') is distinct from 'string' then raise exception 'invalid_master_proposal' using errcode='22023'; end if;
    v_name := btrim(p_changes->>'name');
    if char_length(v_name) not between 1 and 100 or v_name !~ '[^[:space:]]' then raise exception 'invalid_master_proposal' using errcode='22023'; end if;
  end if;
  if (p_changes ? 'employment_type' and coalesce(p_changes->>'employment_type','') not in ('常勤','非常勤'))
    or (p_changes ? 'work_style' and coalesce(p_changes->>'work_style','') not in ('兼務','専従')) then
    raise exception 'invalid_master_proposal' using errcode='22023';
  end if;
  if not private.is_mcp_oauth_active() then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  select name into v_org_name from public.organizations where id=p_org and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles in share mode;
  if not private.is_mcp_oauth_active() or not private.is_org_member(p_org)
    or private.has_management_permission(p_org,auth.uid(),case p_kind when 'client' then 'clients' else 'staffs' end) is distinct from true
    or not exists(select 1 from private.mcp_master_edit_controls where organization_id=p_org and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p_org and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if p_kind='client' then
    select * into v_client from public.clients where organization_id=p_org and id=p_target and deleted_at is null and archived_at is null for share;
    if not found or not private.can_access_client(p_target) then raise exception 'proposal_unavailable' using errcode='42501'; end if;
    v_before := jsonb_build_object('name',v_client.name);
  else
    select * into v_staff from public.staffs where organization_id=p_org and id=p_target and deleted_at is null and archived_at is null for share;
    if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
    v_before := jsonb_build_object('name',v_staff.name,'employment_type',v_staff.employment_type,'work_style',v_staff.work_style);
  end if;
  v_after := v_before || p_changes;
  if p_changes ? 'name' then v_after := jsonb_set(v_after,'{name}',to_jsonb(v_name)); end if;
  if v_after=v_before then raise exception 'invalid_master_proposal' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp_master_edit:'||auth.uid()::text,0));
  if (select count(*) from private.mcp_master_edit_proposals where actor_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour')>=50 then
    raise exception 'proposal_limit' using errcode='54000';
  end if;
  if not private.is_mcp_oauth_active() then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  insert into private.mcp_master_edit_proposals(organization_id,actor_id,oauth_client_id,oauth_session_id,kind,target_id,organization_name,before_content,proposed_content)
    values(p_org,auth.uid(),(auth.jwt()->>'client_id')::uuid,(auth.jwt()->>'session_id')::uuid,p_kind,p_target,v_org_name,v_before,v_after) returning id into v_id;
  return v_id;
end $$;
revoke all on function private.prepare_mcp_master_edit(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role,mcp_import;
