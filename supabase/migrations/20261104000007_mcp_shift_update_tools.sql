-- MCP can prepare an immutable proposal but can never confirm a shift update.
create function public.prepare_mcp_shift_update(p_organization_id uuid,p_shift_id uuid,p_start timestamptz,p_end timestamptz,p_segments jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_expires timestamptz;
begin
  v_id := private.prepare_mcp_shift_update(p_organization_id,p_shift_id,p_start,p_end,p_segments);
  select expires_at into v_expires from private.mcp_shift_update_proposals where id=v_id and actor_id=auth.uid();
  return jsonb_build_object('status','confirmation_required','proposal_id',v_id,'expires_at',v_expires);
end $$;
revoke all on function public.prepare_mcp_shift_update(uuid,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.prepare_mcp_shift_update(uuid,uuid,timestamptz,timestamptz,jsonb) to mcp_import;

create function public.get_mcp_shift_update_result(p_organization_id uuid,p_proposal_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare p private.mcp_shift_update_proposals%rowtype; s public.shifts%rowtype;
begin
  perform private.assert_mcp_shift_read(p_organization_id);
  if private.get_member_shift_action_scope(p_organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p_organization_id,auth.uid(),'edit') is distinct from 'all'
    or not exists(select 1 from private.mcp_shift_update_controls where organization_id=p_organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p_organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into p from private.mcp_shift_update_proposals where id=p_proposal_id and organization_id=p_organization_id
    and actor_id=auth.uid() and oauth_client_id::text=auth.jwt()->>'client_id' and oauth_session_id::text=auth.jwt()->>'session_id';
  if not found then return null; end if;
  select * into s from public.shifts where id=p.shift_id and organization_id=p.organization_id and deleted_at is null;
  if not found or s.status='cancelled' or not private.can_access_shift(s.id) or not private.can_access_client(s.client_id) then return null; end if;
  if p.confirmed_at is not null then
    return jsonb_build_object('status','updated','shift_id',s.id,'google_sync_status',s.google_sync_status);
  end if;
  if p.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if private.mcp_shift_change_snapshot(p.organization_id,p.shift_id) is distinct from p.original_snapshot
    or private.mcp_shift_update_references(p.organization_id,p.shift_id,p.proposed_content->'segments') is distinct from p.reference_content then
    return jsonb_build_object('status','changed');
  end if;
  return jsonb_build_object('status','confirmation_required');
end $$;
revoke all on function public.get_mcp_shift_update_result(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_shift_update_result(uuid,uuid) to mcp_import;
notify pgrst, 'reload schema';
