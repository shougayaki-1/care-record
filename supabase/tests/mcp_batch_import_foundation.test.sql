begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(12);
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
select ok(not has_function_privilege('mcp_import','private.submit_mcp_batch_item(uuid,uuid,text,jsonb,boolean)','execute'),'internal helper is not exposed');
create temp table item as select private.submit_mcp_batch_item('16900000-0000-0000-0000-00000000000a','18700000-0000-0000-0000-000000000001','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}',false) as result;
select is((select result->>'status' from item),'submitted','first item is submitted');
select is((private.submit_mcp_batch_item('16900000-0000-0000-0000-00000000000a','18700000-0000-0000-0000-000000000001','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}',false)->>'replayed')::boolean,true,'same key and payload replay');
select is((select count(*)::int from public.ai_import_candidates),1,'replay creates no additional candidate');
select throws_ok($$select private.submit_mcp_batch_item('16900000-0000-0000-0000-00000000000a','18700000-0000-0000-0000-000000000001','different.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}',false)$$,'22023','request_conflict','changed input cannot reuse request key');
select is(private.submit_mcp_batch_item('16900000-0000-0000-0000-00000000000a','18700000-0000-0000-0000-000000000002','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}',false)->>'status','possible_duplicate','matching content is flagged without submission');
select is((select count(*)::int from public.ai_import_candidates),1,'possible duplicate is not automatically submitted');
select is(private.submit_mcp_batch_item('16900000-0000-0000-0000-00000000000a','18700000-0000-0000-0000-000000000003','different.pdf','{"meta":{},"values":{},"warnings":["check"],"confidence":"medium"}',false)->>'status','possible_duplicate','confidence and warnings do not disguise matching content');
select is(private.submit_mcp_batch_item('16900000-0000-0000-0000-00000000000a','18700000-0000-0000-0000-000000000002','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}',true)->>'status','submitted','explicit duplicate override submits');
select is((select count(*)::int from public.ai_import_candidates),2,'override creates one candidate');
update private.mcp_import_controls set enabled=false where organization_id='16900000-0000-0000-0000-00000000000a';
select throws_ok($$select private.submit_mcp_batch_item('16900000-0000-0000-0000-00000000000a','18700000-0000-0000-0000-000000000001','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}',false)$$,'42501','mcp_import_unavailable','disabled import rejects replay');
select throws_ok($$select private.submit_mcp_batch_item('16900000-0000-0000-0000-00000000000b','18700000-0000-0000-0000-000000000001','test.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}',false)$$,'42501','mcp_import_unavailable','separate disabled organization rejects');
select * from finish();
rollback;
