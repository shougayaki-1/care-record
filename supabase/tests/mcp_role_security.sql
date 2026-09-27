-- Run after migrations with a privileged local connection.
-- This is also run by `supabase test db` as a pgTAP contract.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(1);
do $$
declare
  allowed_functions text[];
begin
  if pg_has_role('mcp_import', 'authenticated', 'member') then
    raise exception 'MCP role inherits application privileges';
  end if;
  if not pg_has_role('authenticator', 'mcp_import', 'member') then
    raise exception 'PostgREST cannot select the MCP role';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and has_table_privilege('mcp_import', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  ) then
    raise exception 'MCP role has direct public table access';
  end if;
  select array_agg(p.proname order by p.proname) into allowed_functions
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('mcp_import', p.oid, 'EXECUTE');
  if allowed_functions is distinct from array['get_mcp_self_staff_names', 'list_mcp_workspaces', 'submit_mcp_candidate'] then
    raise exception 'Unexpected MCP RPC privileges: %', allowed_functions;
  end if;
  if has_table_privilege('authenticated', 'public.ai_import_candidates', 'INSERT')
    or has_function_privilege('authenticated', 'public.submit_mcp_candidate(uuid,text,jsonb)', 'EXECUTE') then
    raise exception 'Browser sessions can forge MCP candidates';
  end if;
  if has_table_privilege('authenticated', 'public.ai_import_candidates', 'DELETE') then
    raise exception 'A sender can retract an AI submission without reviewer permission';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'public.mcp_access_token_hook(jsonb)', 'EXECUTE')
    or not has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') then
    raise exception 'Auth server cannot invoke the access token hook';
  end if;
  if public.mcp_access_token_hook('{"client_id":"client", "claims":{"role":"authenticated"}}'::jsonb)
       -> 'claims' ->> 'role' <> 'mcp_import'
     or public.mcp_access_token_hook('{"claims":{"role":"authenticated"}}'::jsonb)
       -> 'claims' ->> 'role' <> 'authenticated' then
    raise exception 'OAuth token role isolation failed';
  end if;
end;
$$;
select pass('MCP OAuth role has only the intended privileges');
select * from finish();
rollback;
