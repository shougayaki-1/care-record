-- Only an authenticated browser can confirm; MCP has no execute privilege.
create function public.confirm_mcp_shift_cancel(p_proposal_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.confirm_mcp_shift_cancel(p_proposal_id)
$$;
revoke all on function public.confirm_mcp_shift_cancel(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.confirm_mcp_shift_cancel(uuid) to authenticated;
notify pgrst, 'reload schema';
