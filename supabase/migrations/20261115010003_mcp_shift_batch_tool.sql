-- MCP may create a batch of frozen proposals but cannot read the browser review
-- or confirm it. Each proposal is authorized by the existing single-item path.
create function public.prepare_mcp_shift_update_batch(p_organization_id uuid,p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_exp timestamptz;
begin
  v_id := private.prepare_mcp_shift_update_batch(p_organization_id,p_items);
  select expires_at into v_exp from private.mcp_shift_update_batches where id=v_id and actor_id=auth.uid();
  return jsonb_build_object('status','confirmation_required','batch_id',v_id,'expires_at',v_exp,'count',jsonb_array_length(p_items));
end $$;
revoke all on function public.prepare_mcp_shift_update_batch(uuid,jsonb) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.prepare_mcp_shift_update_batch(uuid,jsonb) to mcp_import;
notify pgrst, 'reload schema';
