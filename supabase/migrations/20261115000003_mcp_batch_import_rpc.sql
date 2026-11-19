-- Public OAuth entry point; the private helper enforces organization, session,
-- role, feature control and existing candidate RPC limits on every call.
create function public.submit_mcp_batch_candidates(p_organization_id uuid,p_items jsonb)
returns jsonb language sql volatile security definer set search_path='' as $$
  select private.submit_mcp_batch_items(p_organization_id,p_items)
$$;
revoke all on function public.submit_mcp_batch_candidates(uuid,jsonb) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.submit_mcp_batch_candidates(uuid,jsonb) to mcp_import;
notify pgrst, 'reload schema';
