begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select no_plan();
-- Test-only access to pgTAP; rolled back at the end of this transaction.
grant usage on schema extensions to mcp_import;
grant execute on all functions in schema extensions to mcp_import;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
 ('16900000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp169owner@example.invalid','x',now(),now(),now()),
 ('16900000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp169member@example.invalid','x',now(),now(),now());
insert into public.profiles(id,name) values ('16900000-0000-0000-0000-000000000001','Owner'),('16900000-0000-0000-0000-000000000002','Member') on conflict(id) do update set name=excluded.name;
insert into public.organizations(id,name) values ('16900000-0000-0000-0000-00000000000a','First'),('16900000-0000-0000-0000-00000000000b','Second');
insert into public.organization_members(organization_id,user_id,role) values
 ('16900000-0000-0000-0000-00000000000a','16900000-0000-0000-0000-000000000001','owner'),
 ('16900000-0000-0000-0000-00000000000a','16900000-0000-0000-0000-000000000002','member'),
 ('16900000-0000-0000-0000-00000000000b','16900000-0000-0000-0000-000000000002','owner');
insert into public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at) values
 ('mcp169-owner','mcp169-owner','16900000-0000-0000-0000-000000000001',now(),now()+interval '1 hour'),
 ('mcp169-member','mcp169-member','16900000-0000-0000-0000-000000000002',now(),now()+interval '1 hour');
select ok(not has_table_privilege('authenticated','private.mcp_import_controls','SELECT,INSERT,UPDATE,DELETE'),'authenticated cannot access switch directly');
select ok(not has_table_privilege('mcp_import','private.mcp_import_controls','SELECT,INSERT,UPDATE,DELETE'),'MCP cannot access switch directly');
select ok(not has_function_privilege('mcp_import','public.disable_mcp_import(uuid)','EXECUTE'),'MCP cannot change switch');
select ok(not has_function_privilege('anon','public.disable_mcp_import(uuid)','EXECUTE'),'anon cannot change switch');
set local role mcp_import;
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","client_id":"fixture"}',true);
select throws_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000a','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}')$$,'42501','mcp_import_unavailable','missing switch rejects direct RPC');
reset role;
insert into private.mcp_import_controls values ('16900000-0000-0000-0000-00000000000a',true);
set local role mcp_import;
select lives_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000a','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}')$$,'privileged fixture simulates previously enabled organization');
select throws_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000b','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}')$$,'42501','mcp_import_unavailable','another organization remains disabled');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"authenticated","session_id":"mcp169-member"}',true);
select throws_ok($$select public.disable_mcp_import('16900000-0000-0000-0000-00000000000a')$$,'42501','permission_denied','member cannot disable another organization');
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000001","role":"authenticated","session_id":"mcp169-owner"}',true);
select lives_ok($$select public.disable_mcp_import('16900000-0000-0000-0000-00000000000a')$$,'owner can disable');
reset role;
select is((select enabled from private.mcp_import_controls where organization_id='16900000-0000-0000-0000-00000000000a'),false,'switch disabled');
select is((select count(*)::int from public.audit_events where organization_id='16900000-0000-0000-0000-00000000000a' and action_type='integration.mcp_import.disable' and actor_id='16900000-0000-0000-0000-000000000001' and details->>'previouslyEnabled'='true'),1,'change is audited');
select is((select count(*)::int from public.ai_import_candidates where organization_id='16900000-0000-0000-0000-00000000000a'),1,'existing candidate remains available for review');
set local role mcp_import;
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","client_id":"fixture"}',true);
select throws_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000a','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}')$$,'42501','mcp_import_unavailable','disabled switch rejects direct RPC');
reset role;
create function public.mcp169_fail_audit() returns trigger language plpgsql set search_path='' as $$begin if new.action_type='integration.mcp_import.disable' then raise exception 'fixture_audit_failed'; end if; return new; end$$;
create trigger mcp169_fail_audit before insert on public.audit_events for each row execute function public.mcp169_fail_audit();
update private.mcp_import_controls set enabled=true where organization_id='16900000-0000-0000-0000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000001","role":"authenticated","session_id":"mcp169-owner"}',true);
select throws_ok($$select public.disable_mcp_import('16900000-0000-0000-0000-00000000000a')$$,'P0001','fixture_audit_failed','audit failure rejects change');
reset role;
select is((select enabled from private.mcp_import_controls where organization_id='16900000-0000-0000-0000-00000000000a'),true,'audit failure rolls back switch');
select * from finish();
rollback;
