-- Only the authenticated proposal owner can read the frozen review. Mutation
-- remains private until the explicit browser confirmation flow is provided.
create function public.get_mcp_shift_cancel_proposal(p_proposal_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare p private.mcp_shift_cancel_proposals%rowtype; s public.shifts%rowtype; v_action text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into p from private.mcp_shift_cancel_proposals where id=p_proposal_id and actor_id=auth.uid();
  if not found then return null; end if;
  v_action := case p.operation when 'cancel' then 'edit' else 'delete' end;
  if not private.mcp_shift_cancel_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id)
    or not private.is_org_member(p.organization_id)
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p.organization_id,auth.uid(),v_action) is distinct from 'all'
    or not exists(select 1 from public.organizations where id=p.organization_id and deleted_at is null)
    or not exists(select 1 from private.mcp_shift_cancel_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_shift_read_controls where organization_id=p.organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p.organization_id and enabled) then return null; end if;
  select * into s from public.shifts where id=p.shift_id and organization_id=p.organization_id;
  if not found or not private.can_access_client(s.client_id) then return null; end if;
  if p.confirmed_at is not null then
    return jsonb_build_object('status','updated','operation',p.operation,'shift_id',s.id,'google_sync_status',s.google_sync_status);
  end if;
  if s.deleted_at is not null or not private.can_access_shift(s.id) then return null; end if;
  if p.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if private.mcp_shift_cancel_snapshot(p.organization_id,p.shift_id) is distinct from p.original_snapshot
    or private.mcp_shift_cancel_references(p.organization_id,p.shift_id) is distinct from p.reference_content then
    return jsonb_build_object('status','changed');
  end if;
  return jsonb_build_object('status','confirmation_required','proposal_id',p.id,'expires_at',p.expires_at,
    'operation',p.operation,'reason',p.reason,'before',p.before_content,'references',p.reference_content);
end $$;
revoke all on function public.get_mcp_shift_cancel_proposal(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_shift_cancel_proposal(uuid) to authenticated;
notify pgrst, 'reload schema';
