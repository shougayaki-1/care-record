-- Only a signed-in browser session may explicitly confirm a stored proposal.
-- The internal function rechecks the actor, session, OAuth connection, scopes,
-- fixed content, conflicts, and writes the update and audit atomically.
create function public.confirm_mcp_shift_update(p_proposal_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.confirm_mcp_shift_update(p_proposal_id)
$$;
revoke all on function public.confirm_mcp_shift_update(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.confirm_mcp_shift_update(uuid) to authenticated;
notify pgrst, 'reload schema';
