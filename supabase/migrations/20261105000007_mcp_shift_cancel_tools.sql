-- MCP may prepare a fixed proposal but only the browser can confirm it.
create function public.prepare_mcp_shift_cancel(p_organization_id uuid,p_shift_id uuid,p_operation text,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_expires timestamptz;
begin
  v_id := private.prepare_mcp_shift_cancel(p_organization_id,p_shift_id,p_operation,p_reason);
  select expires_at into v_expires from private.mcp_shift_cancel_proposals where id=v_id and actor_id=auth.uid();
  return jsonb_build_object('status','confirmation_required','proposal_id',v_id,'expires_at',v_expires);
end $$;
revoke all on function public.prepare_mcp_shift_cancel(uuid,uuid,text,text) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.prepare_mcp_shift_cancel(uuid,uuid,text,text) to mcp_import;

create function public.get_mcp_shift_cancel_result(p_organization_id uuid,p_proposal_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare p private.mcp_shift_cancel_proposals%rowtype; s public.shifts%rowtype; v_action text;
begin
  perform private.assert_mcp_shift_read(p_organization_id);
  select * into p from private.mcp_shift_cancel_proposals where id=p_proposal_id and organization_id=p_organization_id
    and actor_id=auth.uid() and oauth_client_id::text=auth.jwt()->>'client_id' and oauth_session_id::text=auth.jwt()->>'session_id';
  if not found then return null; end if;
  v_action := case p.operation when 'cancel' then 'edit' else 'delete' end;
  if private.get_member_shift_action_scope(p_organization_id,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p_organization_id,auth.uid(),v_action) is distinct from 'all'
    or not exists(select 1 from private.mcp_shift_cancel_controls where organization_id=p_organization_id and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p_organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
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
  return jsonb_build_object('status','confirmation_required');
end $$;
revoke all on function public.get_mcp_shift_cancel_result(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_shift_cancel_result(uuid,uuid) to mcp_import;
notify pgrst, 'reload schema';
