begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(11);
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
insert into private.mcp_reauth_proofs(user_id,client_id,consent_granted_at,verified_at) select user_id,client_id,granted_at,clock_timestamp() from auth.oauth_consents where id='16900000-0000-0000-0000-000000000005';
insert into auth.sessions(id,user_id,oauth_client_id,created_at) values ('16900000-0000-0000-0000-000000000004','16900000-0000-0000-0000-000000000002','16900000-0000-0000-0000-000000000003',now());
insert into private.mcp_import_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('16900000-0000-0000-0000-00000000000a',true,'{}','16900000-0000-0000-0000-000000000001',now());
select set_config('request.jwt.claims','{"sub":"16900000-0000-0000-0000-000000000002","role":"mcp_import","exp":4102444800,"client_id":"16900000-0000-0000-0000-000000000003","session_id":"16900000-0000-0000-0000-000000000004"}',true);
create temp table output as select public.submit_mcp_batch_candidates('16900000-0000-0000-0000-00000000000a',jsonb_build_array(
 jsonb_build_object('request_id','18700000-0000-0000-0000-000000000011','source_file_name','first.pdf','payload','{"meta":{},"values":{},"warnings":[],"confidence":"low"}'::jsonb,'allow_duplicate',false),
 jsonb_build_object('request_id','bad-uuid','source_file_name','second.pdf','payload','{"meta":{},"values":{},"warnings":[],"confidence":"low"}'::jsonb,'allow_duplicate',false),
 jsonb_build_object('request_id','18700000-0000-0000-0000-000000000012','source_file_name','third.pdf','payload','{"meta":{},"values":{},"warnings":[],"confidence":"low"}'::jsonb,'allow_duplicate',false))) as result;
select is((select result->'items'->0->>'status' from output),'submitted','first candidate submitted');
select is((select result->'items'->1->>'status' from output),'invalid_input','invalid row reported independently');
select is((select result->'items'->2->>'status' from output),'possible_duplicate','duplicate reported separately');
select is((select count(*)::int from public.ai_import_candidates),1,'only valid nonduplicate candidate created');
select is(private.submit_mcp_batch_items('16900000-0000-0000-0000-00000000000a',jsonb_build_array(jsonb_build_object('request_id','18700000-0000-0000-0000-000000000011','source_file_name','first.pdf','payload','{"meta":{},"values":{},"warnings":[],"confidence":"low"}'::jsonb,'allow_duplicate',false)))->'items'->0->>'replayed','true','retry returns original result');
select throws_ok($$select private.submit_mcp_batch_items('16900000-0000-0000-0000-00000000000a','[]')$$,'22023','invalid_batch','empty batch is rejected');
select ok(not has_function_privilege('mcp_import','private.submit_mcp_batch_items(uuid,jsonb)','execute'),'batch helper is not exposed');
select ok(has_function_privilege('mcp_import','public.submit_mcp_batch_candidates(uuid,jsonb)','execute'),'MCP can invoke authorized batch RPC');
select ok(not has_function_privilege('authenticated','public.submit_mcp_batch_candidates(uuid,jsonb)','execute'),'browser role cannot invoke batch RPC');
update private.mcp_import_controls set enabled=false where organization_id='16900000-0000-0000-0000-00000000000a';
select throws_ok($$select private.submit_mcp_batch_items('16900000-0000-0000-0000-00000000000a','[{"request_id":"bad"}]')$$,'42501','mcp_import_unavailable','disabled organization rejects even malformed batch');
update private.mcp_import_controls set enabled=true where organization_id='16900000-0000-0000-0000-00000000000a';
update auth.oauth_consents set revoked_at=clock_timestamp() where id='16900000-0000-0000-0000-000000000005';
select throws_ok($$select private.submit_mcp_batch_items('16900000-0000-0000-0000-00000000000a','[]')$$,'42501','mcp_oauth_required','revoked OAuth rejects before validation');
select * from finish();
rollback;
