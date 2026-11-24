-- The MCP connection may read only its own subscription and cannot enable,
-- disable, select recipients, dispatch alerts, or change their content.
create function public.get_mcp_business_alert_status(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not private.is_mcp_oauth_active() or not private.is_org_member(p_organization_id)
    or not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  select jsonb_build_object('enabled',enabled,'frequency',frequency,'pending_reports',pending_reports,'unassigned_shifts',unassigned_shifts)
    into v_result from private.mcp_business_alert_subscriptions where organization_id=p_organization_id and user_id=auth.uid();
  return coalesce(v_result,jsonb_build_object('enabled',false,'frequency','daily','pending_reports',false,'unassigned_shifts',false));
end $$;
revoke all on function public.get_mcp_business_alert_status(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_business_alert_status(uuid) to mcp_import;
notify pgrst, 'reload schema';
