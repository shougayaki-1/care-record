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
-- Keep this member unable to manage integrations while allowing record creation.
insert into public.organization_roles(id,organization_id,name,permissions) values ('16900000-0000-0000-0000-000000000006','16900000-0000-0000-0000-00000000000a','Record creator','{"records":{"create":"all"}}');
insert into public.organization_member_roles(organization_id,user_id,role_id) values ('16900000-0000-0000-0000-00000000000a','16900000-0000-0000-0000-000000000002','16900000-0000-0000-0000-000000000006');
insert into public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at) values
 ('mcp169-owner','mcp169-owner','16900000-0000-0000-0000-000000000001',now(),now()+interval '1 hour'),
 ('mcp169-member','mcp169-member','16900000-0000-0000-0000-000000000002',now(),now()+interval '1 hour');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method) values ('16900000-0000-0000-0000-000000000003','dynamic','http://localhost/callback','authorization_code','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values ('16900000-0000-0000-0000-000000000005','16900000-0000-0000-0000-000000000002','16900000-0000-0000-0000-000000000003','openid');
insert into auth.sessions(id,user_id,oauth_client_id,created_at) values ('16900000-0000-0000-0000-000000000004','16900000-0000-0000-0000-000000000002','16900000-0000-0000-0000-000000000003',now());
select ok(not has_table_privilege('authenticated','private.mcp_import_controls','SELECT,INSERT,UPDATE,DELETE'),'authenticated cannot access switch directly');
select ok(not has_table_privilege('mcp_import','private.mcp_import_controls','SELECT,INSERT,UPDATE,DELETE'),'MCP cannot access switch directly');
select ok(not has_function_privilege('mcp_import','public.disable_mcp_import(uuid)','EXECUTE'),'MCP cannot change switch');
select ok(not has_function_privilege('anon','public.disable_mcp_import(uuid)','EXECUTE'),'anon cannot change switch');
set local role mcp_import;
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","exp":4102444800,"client_id":"16900000-0000-0000-0000-000000000003","session_id":"16900000-0000-0000-0000-000000000004"}',true);
select throws_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000a','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}')$$,'42501','mcp_import_unavailable','missing switch rejects direct RPC');
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","client_id":"16900000-0000-0000-0000-000000000003","session_id":"16900000-0000-0000-0000-000000000004"}',true);
select throws_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000a','', '{}')$$,'42501','mcp_oauth_required','missing exp rejects');
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","exp":"4102444800","client_id":"16900000-0000-0000-0000-000000000003","session_id":"16900000-0000-0000-0000-000000000004"}',true);
select throws_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000a','', '{}')$$,'42501','mcp_oauth_required','non-numeric exp rejects');
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","exp":1,"client_id":"16900000-0000-0000-0000-000000000003","session_id":"16900000-0000-0000-0000-000000000004"}',true);
select throws_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000a','', '{}')$$,'42501','mcp_oauth_required','expired exp rejects');

reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"authenticated","session_id":"mcp169-member"}',true);
select throws_ok($$select public.enable_mcp_import('16900000-0000-0000-0000-00000000000a','{"provider":"a","processing":"b","region":"c","retention":"d","secondary_use":"e","notice":"f"}')$$,'42501','permission_denied','member cannot enable');
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000001","role":"authenticated","session_id":"mcp169-owner"}',true);
select is(public.get_mcp_import_control('16900000-0000-0000-0000-00000000000a')->>'enabled','false','missing switch is disabled');
select throws_ok($$select public.enable_mcp_import('16900000-0000-0000-0000-00000000000a','{}')$$,'22023','invalid_mcp_conditions','missing conditions rejected');
select throws_ok($$select public.enable_mcp_import('16900000-0000-0000-0000-00000000000a','[]')$$,'22023','invalid_mcp_conditions','non-object rejected');
select throws_ok($$select public.enable_mcp_import('16900000-0000-0000-0000-00000000000a','{"provider":"a","processing":"b","region":" ","retention":"d","secondary_use":"e","notice":"f"}')$$,'22023','invalid_mcp_conditions','empty condition rejected');
select throws_ok($$select public.enable_mcp_import('16900000-0000-0000-0000-00000000000a',jsonb_build_object('provider',repeat('x',501),'processing','b','region','c','retention','d','secondary_use','e','notice','f'))$$,'22023','invalid_mcp_conditions','oversize condition rejected');
select lives_ok($$select public.enable_mcp_import('16900000-0000-0000-0000-00000000000a','{"provider":"a","processing":"b","region":"c","retention":"d","secondary_use":"e","notice":"f"}')$$,'manager can enable with all conditions');
select is(public.get_mcp_import_control('16900000-0000-0000-0000-00000000000a')->>'enabled','true','enabled switch is readable by manager');
reset role;
select is((select count(*)::int from public.audit_events where organization_id='16900000-0000-0000-0000-00000000000a' and action_type='integration.mcp_import.enable' and details->'confirmedFields' ? 'region' and not (details ? 'conditions')),1,'condition fields and actor are audited without free text');
set local role mcp_import;
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","exp":4102444800,"client_id":"16900000-0000-0000-0000-000000000003","session_id":"16900000-0000-0000-0000-000000000004"}',true);
select lives_ok($$select public.submit_mcp_candidate('16900000-0000-0000-0000-00000000000a','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}')$$,'enabled organization can submit');
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
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","exp":4102444800,"client_id":"16900000-0000-0000-0000-000000000003","session_id":"16900000-0000-0000-0000-000000000004"}',true);
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
