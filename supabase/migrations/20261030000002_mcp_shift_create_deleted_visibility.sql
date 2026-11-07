-- Do not expose proposals for deleted organizations or archived targets.
create or replace function public.get_mcp_shift_create_proposal(p_proposal_id uuid) returns jsonb
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
    into result from public.organizations o join public.clients c on c.id=p.client_id and c.organization_id=o.id and c.deleted_at is null
    join public.staffs s on s.id=p.staff_id and s.organization_id=o.id and s.deleted_at is null and s.archived_at is null
    where o.id=p.organization_id and o.deleted_at is null;
  return result;
end $$;
