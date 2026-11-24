-- Browser review and confirmation reuse each single-shift proposal's existing
-- authorization, frozen display data, concurrency checks and audit trail.
create function public.get_mcp_shift_update_batch(p_batch_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_batch private.mcp_shift_update_batches%rowtype; v_item record; v_review jsonb; v_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into v_batch from private.mcp_shift_update_batches where id=p_batch_id and actor_id=auth.uid();
  if not found or not private.mcp_shift_update_oauth_valid(v_batch.actor_id,v_batch.oauth_client_id,v_batch.oauth_session_id) then
    return null;
  end if;
  for v_item in select position,proposal_id,has_overlap,has_unassigned from private.mcp_shift_update_batch_items where batch_id=v_batch.id order by position loop
    v_review := public.get_mcp_shift_update_proposal(v_item.proposal_id);
    if v_review is null then return null; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('position',v_item.position,'proposal_id',v_item.proposal_id,'has_overlap',v_item.has_overlap,'has_unassigned',v_item.has_unassigned,'review',v_review));
  end loop;
  return jsonb_build_object('batch_id',v_batch.id,'expires_at',v_batch.expires_at,'items',v_items);
end $$;
revoke all on function public.get_mcp_shift_update_batch(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_shift_update_batch(uuid) to authenticated;

create function public.confirm_mcp_shift_update_batch(p_batch_id uuid,p_proposal_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_batch private.mcp_shift_update_batches%rowtype; v_id uuid; v_result jsonb; v_results jsonb := '[]'::jsonb; v_message text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if p_proposal_ids is null or cardinality(p_proposal_ids) not between 1 and 10
    or array_position(p_proposal_ids,null) is not null
    or (select count(distinct x) from unnest(p_proposal_ids) x) <> cardinality(p_proposal_ids) then
    raise exception 'invalid_shift_proposal' using errcode='22023';
  end if;
  select * into v_batch from private.mcp_shift_update_batches where id=p_batch_id and actor_id=auth.uid() for update;
  if not found or not private.mcp_shift_update_oauth_valid(v_batch.actor_id,v_batch.oauth_client_id,v_batch.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if exists(select 1 from unnest(p_proposal_ids) x where not exists(
    select 1 from private.mcp_shift_update_batch_items i where i.batch_id=v_batch.id and i.proposal_id=x)) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  -- Stable order prevents different selections from locking proposals in opposite order.
  for v_id in select i.proposal_id from private.mcp_shift_update_batch_items i
    where i.batch_id=v_batch.id and i.proposal_id=any(p_proposal_ids) order by i.position loop
    begin
      v_result := private.confirm_mcp_shift_update(v_id);
      v_results := v_results || jsonb_build_array(jsonb_build_object('proposal_id',v_id,'status','updated','result',v_result));
    exception when unique_violation or invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      if v_message not in ('shift_conflict','proposal_changed','proposal_expired') then raise; end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('proposal_id',v_id,'status',v_message));
    end;
  end loop;
  return jsonb_build_object('items',v_results);
end $$;
revoke all on function public.confirm_mcp_shift_update_batch(uuid,uuid[]) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.confirm_mcp_shift_update_batch(uuid,uuid[]) to authenticated;
notify pgrst, 'reload schema';
