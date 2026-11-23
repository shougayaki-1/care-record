begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(15);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('18300000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-cancel-proposal@example.invalid','x',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method) values
('18300000-0000-0000-0000-000000000012','dynamic','http://localhost/callback','authorization_code','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values
('18300000-0000-0000-0000-000000000013','18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012','openid');
insert into auth.sessions(id,user_id,oauth_client_id,created_at) values
('18300000-0000-0000-0000-000000000014','18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012',now());
insert into public.organizations(id,name) values ('18300000-0000-0000-0000-000000000015','Synthetic');
insert into public.clients(id,organization_id,name) values ('18300000-0000-0000-0000-000000000016','18300000-0000-0000-0000-000000000015','Synthetic');
insert into public.shifts(id,organization_id,client_id,start_at,end_at) values ('18300000-0000-0000-0000-000000000017','18300000-0000-0000-0000-000000000015','18300000-0000-0000-0000-000000000016','2026-11-01 00:00+00','2026-11-01 01:00+00');
insert into private.mcp_shift_cancel_proposals(id,organization_id,actor_id,oauth_client_id,oauth_session_id,shift_id,original_snapshot,before_content,operation,reason,reference_content)
values ('18300000-0000-0000-0000-000000000018','18300000-0000-0000-0000-000000000015','18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012','18300000-0000-0000-0000-000000000014','18300000-0000-0000-0000-000000000017',decode(repeat('00',32),'hex'),'{}','cancel','','{}');
select is((select expires_at-created_at from private.mcp_shift_cancel_proposals where id='18300000-0000-0000-0000-000000000018'),interval '10 minutes','proposal has a bounded ten-minute lifetime');
select ok((select confirmed_at is null and confirmed_session_id is null from private.mcp_shift_cancel_proposals where id='18300000-0000-0000-0000-000000000018'),'new proposal is unconfirmed');
select ok(not has_table_privilege('mcp_import','private.mcp_shift_cancel_proposals','insert') and not has_table_privilege('authenticated','private.mcp_shift_cancel_proposals','select'),'proposal table is inaccessible to application roles');
select ok(not has_table_privilege('mcp_import','private.mcp_shift_cancel_controls','update') and not has_table_privilege('authenticated','private.mcp_shift_cancel_controls','update'),'control table cannot be changed directly');
select ok(not has_function_privilege('mcp_import','private.mcp_shift_cancel_oauth_valid(uuid,uuid,uuid)','execute') and not has_function_privilege('authenticated','private.mcp_shift_cancel_oauth_valid(uuid,uuid,uuid)','execute'),'OAuth helper is private');
select ok(not private.mcp_shift_cancel_oauth_valid('18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012','18300000-0000-0000-0000-000000000014'),'session without reauthentication proof is denied');
insert into private.mcp_reauth_proofs(user_id,client_id,consent_granted_at,verified_at)
select user_id,client_id,granted_at,clock_timestamp() from auth.oauth_consents where id='18300000-0000-0000-0000-000000000013';
select ok(private.mcp_shift_cancel_oauth_valid('18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012','18300000-0000-0000-0000-000000000014'),'active session and proof accepted');
select ok(not private.mcp_shift_cancel_oauth_valid('18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012','18300000-0000-0000-0000-000000000099'),'other session denied');
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='18300000-0000-0000-0000-000000000014';
select ok(not private.mcp_shift_cancel_oauth_valid('18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012','18300000-0000-0000-0000-000000000014'),'expired session denied');
update auth.sessions set not_after=null where id='18300000-0000-0000-0000-000000000014';
update private.mcp_reauth_proofs set verified_at=clock_timestamp()-interval '31 days';
select ok(not private.mcp_shift_cancel_oauth_valid('18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012','18300000-0000-0000-0000-000000000014'),'expired reauthentication denied');
update private.mcp_reauth_proofs set verified_at=clock_timestamp();
update auth.oauth_consents set revoked_at=clock_timestamp() where id='18300000-0000-0000-0000-000000000013';
select ok(not private.mcp_shift_cancel_oauth_valid('18300000-0000-0000-0000-000000000011','18300000-0000-0000-0000-000000000012','18300000-0000-0000-0000-000000000014'),'revoked consent denied');
select ok((select relrowsecurity from pg_class where oid='private.mcp_shift_cancel_proposals'::regclass),'proposal RLS enabled');
select ok((select relrowsecurity from pg_class where oid='private.mcp_shift_cancel_controls'::regclass),'control RLS enabled');
select throws_ok($$update private.mcp_shift_cancel_proposals set operation='delete' where id='18300000-0000-0000-0000-000000000018'$$,'23514',null,'physical delete is not a supported operation');
select throws_ok($$update private.mcp_shift_cancel_proposals set reason=repeat('x',501) where id='18300000-0000-0000-0000-000000000018'$$,'23514',null,'reason is bounded');
select * from finish();
rollback;
