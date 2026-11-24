-- The statistics screen's PostgREST queries have a 1,000-row limit. Reject
-- larger inputs instead of presenting a total that can differ from the screen.
alter function public.get_mcp_kpi_source(uuid,text) set schema private;
revoke all on function private.get_mcp_kpi_source(uuid,text) from public, anon, authenticated, service_role, mcp_import;

create function public.get_mcp_kpi_source(p_organization_id uuid, p_month text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare source jsonb;
begin
  source := private.get_mcp_kpi_source(p_organization_id, p_month);
  if jsonb_array_length(source->'shifts') > 1000
     or jsonb_array_length(source->'reports') > 1000
     or jsonb_array_length(source->'internal_work') > 1000 then
    raise exception 'mcp_kpi_limit' using errcode='54000';
  end if;
  return source;
end $$;
revoke all on function public.get_mcp_kpi_source(uuid,text) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_kpi_source(uuid,text) to mcp_import;
notify pgrst, 'reload schema';
