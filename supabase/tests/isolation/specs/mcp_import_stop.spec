# Disposable local database only. Run each permutation against a fresh database.
setup
{
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES('19200000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp192@example.invalid','x',now(),now(),now());
INSERT INTO public.profiles(id,name) VALUES('19200000-0000-4000-8000-000000000001','Synthetic manager') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.organizations(id,name) VALUES('19200000-0000-4000-8000-000000000011','Synthetic org');
INSERT INTO public.organization_members(organization_id,user_id,role) VALUES('19200000-0000-4000-8000-000000000011','19200000-0000-4000-8000-000000000001','owner');
INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at) VALUES('mcp192','mcp192','19200000-0000-4000-8000-000000000001',now(),now()+interval '1 hour');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method) values ('19200000-0000-4000-8000-000000000012','dynamic','http://localhost/callback','authorization_code','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values ('19200000-0000-4000-8000-000000000014','19200000-0000-4000-8000-000000000001','19200000-0000-4000-8000-000000000012','openid');
insert into private.mcp_reauth_proofs(user_id,client_id,consent_granted_at,verified_at) select user_id,client_id,granted_at,clock_timestamp() from auth.oauth_consents where id='19200000-0000-4000-8000-000000000014';
insert into auth.sessions(id,user_id,oauth_client_id,created_at) values ('19200000-0000-4000-8000-000000000013','19200000-0000-4000-8000-000000000001','19200000-0000-4000-8000-000000000012',now());
SELECT set_config('request.jwt.claims','{"sub":"19200000-0000-4000-8000-000000000001","role":"authenticated","session_id":"mcp192"}',false);
SELECT public.enable_mcp_import('19200000-0000-4000-8000-000000000011','{"provider":"a","processing":"b","region":"c","retention":"d","secondary_use":"e","notice":"f"}');
}
session "sender"
step "begin_sender" { BEGIN; SET LOCAL ROLE mcp_import; SELECT set_config('request.jwt.claims','{"sub":"19200000-0000-4000-8000-000000000001","role":"mcp_import","exp":4102444800,"client_id":"19200000-0000-4000-8000-000000000012","session_id":"19200000-0000-4000-8000-000000000013"}',true); }
step "send" { SELECT public.submit_mcp_candidate('19200000-0000-4000-8000-000000000011','synthetic.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}'); }
step "send_rejected" { DO $$ BEGIN BEGIN PERFORM public.submit_mcp_candidate('19200000-0000-4000-8000-000000000011','synthetic.pdf','{"meta":{},"values":{},"warnings":[],"confidence":"low"}'); RAISE EXCEPTION 'send unexpectedly accepted'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'mcp_import_unavailable' THEN RAISE; END IF; END; END $$; }
step "commit_sender" { COMMIT; }
step "begin_sender_again" { BEGIN; SET LOCAL ROLE mcp_import; SELECT set_config('request.jwt.claims','{"sub":"19200000-0000-4000-8000-000000000001","role":"mcp_import","exp":4102444800,"client_id":"19200000-0000-4000-8000-000000000012","session_id":"19200000-0000-4000-8000-000000000013"}',true); }
step "commit_sender_again" { COMMIT; }
session "stopper"
step "begin_stopper" { BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"19200000-0000-4000-8000-000000000001","role":"authenticated","session_id":"mcp192"}',true); }
step "stop" { SELECT public.disable_mcp_import('19200000-0000-4000-8000-000000000011'); }
step "commit_stopper" { COMMIT; }
# Stop waits for the in-flight submit and no further submission can pass.
permutation "begin_sender" "send" "begin_stopper" "stop" "commit_sender" "commit_stopper" "begin_sender_again" "send_rejected" "commit_sender_again"
# A send arriving during an uncommitted stop waits, then rejects after stop commits.
permutation "begin_stopper" "stop" "begin_sender" "send_rejected" "commit_stopper" "commit_sender"
