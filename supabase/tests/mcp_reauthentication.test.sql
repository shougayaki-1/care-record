begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(19);
grant usage on schema extensions to authenticated, mcp_import;
grant execute on all functions in schema extensions to authenticated, mcp_import;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('16810000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-reauth@example.invalid','x',now(),now());
insert into public.organizations(id,name) values ('16810000-0000-0000-0000-000000000002','Synthetic');
insert into public.organization_members(organization_id,user_id,role) values ('16810000-0000-0000-0000-000000000002','16810000-0000-0000-0000-000000000001','owner');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method) values
('16810000-0000-0000-0000-000000000003','dynamic','http://localhost/callback','authorization_code','public','none');
insert into auth.oauth_authorizations(id,authorization_id,client_id,redirect_uri,scope) values
('16810000-0000-0000-0000-000000000004','mcp-reauth-test','16810000-0000-0000-0000-000000000003','http://localhost/callback','openid');
insert into auth.sessions(id,user_id,oauth_client_id,created_at) values
('16810000-0000-0000-0000-000000000005','16810000-0000-0000-0000-000000000001','16810000-0000-0000-0000-000000000003',now());
insert into public.user_session_activity(session_hash,auth_session_id,user_id,absolute_expires_at) values
('mcp-reauth-browser','mcp-browser','16810000-0000-0000-0000-000000000001',now()+interval '30 days');
insert into public.reauth_grants(token_hash,user_id,auth_session_id,purpose,expires_at) values
('correct-proof','16810000-0000-0000-0000-000000000001','mcp-browser','mcp_connection',now()+interval '10 minutes'),
('wrong-purpose','16810000-0000-0000-0000-000000000001','mcp-browser','owner_add',now()+interval '10 minutes');
select ok(not has_table_privilege('authenticated','private.mcp_reauth_proofs','SELECT'),'browser cannot read or forge stored proof');
select ok(not has_function_privilege('mcp_import','public.prepare_mcp_reauth(text,text)','EXECUTE'),'MCP cannot issue its own proof');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"16810000-0000-0000-0000-000000000001","role":"authenticated","session_id":"mcp-browser"}',true);
select throws_ok($$select public.prepare_mcp_reauth('mcp-reauth-test','wrong-purpose')$$,'42501','reauth_required','other operation proof rejects');
select lives_ok($$select public.prepare_mcp_reauth('mcp-reauth-test','correct-proof')$$,'fresh one-use step-up proof prepares authorization');
select ok(public.mcp_reauth_prepared('mcp-reauth-test'),'same browser sees prepared authorization');
select throws_ok($$select public.prepare_mcp_reauth('mcp-reauth-test','correct-proof')$$,'42501','reauth_required','step-up proof cannot be consumed twice');
select set_config('request.jwt.claims','{"sub":"16810000-0000-0000-0000-000000000001","role":"authenticated","session_id":"other-browser"}',true);
select ok(not public.mcp_reauth_prepared('mcp-reauth-test'),'other browser cannot use prepared proof');
reset role;
-- Model Auth's first approval order: approval, then new consent.
update auth.oauth_authorizations set user_id='16810000-0000-0000-0000-000000000001',status='approved',approved_at=clock_timestamp() where authorization_id='mcp-reauth-test';
insert into auth.oauth_consents(id,user_id,client_id,scopes,granted_at) values
('16810000-0000-0000-0000-000000000006','16810000-0000-0000-0000-000000000001','16810000-0000-0000-0000-000000000003','openid',clock_timestamp());
set local role mcp_import;
select set_config('request.jwt.claims','{"sub":"16810000-0000-0000-0000-000000000001","role":"mcp_import","exp":4102444800,"client_id":"16810000-0000-0000-0000-000000000003","session_id":"16810000-0000-0000-0000-000000000005"}',true);
select throws_ok($$select public.list_mcp_workspaces()$$,'42501','mcp_oauth_required','Auth approval alone cannot bypass human proof');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"16810000-0000-0000-0000-000000000001","role":"authenticated","session_id":"mcp-browser"}',true);
select lives_ok($$select public.finalize_mcp_reauth('mcp-reauth-test')$$,'initial approval finalizes human proof');
select throws_ok($$select public.finalize_mcp_reauth('mcp-reauth-test')$$,'42501','reauth_required','authorization proof finalizes once');
reset role;
select is((select count(*)::int from public.audit_events where actor_id='16810000-0000-0000-0000-000000000001' and action_type='mcp.connection_reauthenticated'),1,'successful proof emits one audit event');
set local role mcp_import;
select set_config('request.jwt.claims','{"sub":"16810000-0000-0000-0000-000000000001","role":"mcp_import","exp":4102444800,"client_id":"16810000-0000-0000-0000-000000000003","session_id":"16810000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from public.list_mcp_workspaces()),1,'verified OAuth connection works');
reset role;
update private.mcp_reauth_proofs set verified_at=clock_timestamp()-interval '30 days';
set local role mcp_import;
select throws_ok($$select public.list_mcp_workspaces()$$,'42501','mcp_oauth_required','new OAuth session cannot bypass 30-day human proof expiry');
reset role;
update private.mcp_reauth_proofs set verified_at=clock_timestamp();
update auth.oauth_consents set granted_at=clock_timestamp() where id='16810000-0000-0000-0000-000000000006';
set local role mcp_import;
select throws_ok($$select public.list_mcp_workspaces()$$,'42501','mcp_oauth_required','new consent generation cannot reuse old proof');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"16810000-0000-0000-0000-000000000001","role":"authenticated","session_id":"mcp-browser"}',true);
select throws_ok($$select public.finalize_mcp_reauth('mcp-reauth-test')$$,'42501','reauth_required','old authorization cannot rebind proof to new consent');
reset role;
-- An existing active consent is auto-approved by Auth without a new consent row.
insert into auth.oauth_authorizations(id,authorization_id,client_id,redirect_uri,scope) values
('16810000-0000-0000-0000-000000000007','mcp-reauth-existing','16810000-0000-0000-0000-000000000003','http://localhost/callback','openid');
insert into public.reauth_grants(token_hash,user_id,auth_session_id,purpose,expires_at) values
('second-proof','16810000-0000-0000-0000-000000000001','mcp-browser','mcp_connection',now()+interval '10 minutes');
set local role authenticated;
select lives_ok($$select public.prepare_mcp_reauth('mcp-reauth-existing','second-proof')$$,'existing consent still requires fresh human proof');
reset role;
update auth.oauth_authorizations set user_id='16810000-0000-0000-0000-000000000001',status='approved',approved_at=clock_timestamp() where authorization_id='mcp-reauth-existing';
set local role authenticated;
select lives_ok($$select public.finalize_mcp_reauth('mcp-reauth-existing')$$,'auto-approved existing consent finalizes fresh proof');
reset role;
update public.user_session_activity set revoked_at=clock_timestamp() where session_hash='mcp-reauth-browser';
set local role authenticated;
select ok(not public.mcp_reauth_prepared('mcp-reauth-existing'),'revoked browser cannot use preparation');
select throws_ok($$select public.finalize_mcp_reauth('mcp-reauth-existing')$$,'42501','reauth_required','revoked browser cannot finalize');
reset role;
select * from finish();
rollback;
