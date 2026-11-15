-- A non-login group role permits exactly one non-parameterized worker RPC.
-- Operators provision a separate least-privilege login and secret outside this
-- migration; no credentials or schedules are installed here.
do $$
declare v_role pg_catalog.pg_roles%rowtype;
begin
  select * into v_role from pg_catalog.pg_roles where rolname='care_business_alert_worker';
  if not found then
    create role care_business_alert_worker nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  elsif v_role.rolcanlogin or v_role.rolsuper or v_role.rolcreatedb or v_role.rolcreaterole or v_role.rolinherit
    or v_role.rolreplication or v_role.rolbypassrls
    or exists(select 1 from pg_catalog.pg_auth_members m where m.member=v_role.oid) then
    raise exception 'unsafe_business_alert_worker_role';
  end if;
end $$;

create function public.run_mcp_business_alerts()
returns integer language plpgsql volatile security definer set search_path='' as $$
declare v_now timestamptz := clock_timestamp(); v_org uuid; v_user uuid; v_result jsonb; v_total integer := 0; v_round integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('care_business_alert_worker',0)) then
    raise exception 'alert_dispatch_busy' using errcode='55P03';
  end if;
  loop
    v_round := v_round + 1;
    v_result := private.dispatch_mcp_business_alerts(v_now,1000,v_org,v_user);
    if v_round > 100 and (v_result->>'scanned')::integer > 0 then raise exception 'alert_dispatch_limit' using errcode='54000'; end if;
    v_total := v_total + (v_result->>'created')::integer;
    exit when (v_result->>'scanned')::integer < 1000;
    v_org := (v_result->>'next_org')::uuid;
    v_user := (v_result->>'next_user')::uuid;
  end loop;
  return v_total;
end $$;
revoke all on function public.run_mcp_business_alerts() from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.run_mcp_business_alerts() to care_business_alert_worker;
