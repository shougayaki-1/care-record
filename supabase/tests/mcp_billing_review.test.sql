begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(10);
grant usage on schema extensions to mcp_import;
grant execute on all functions in schema extensions to mcp_import;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('18600000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp186@example.invalid','x',now(),now());
insert into public.organizations(id,name) values ('18600000-0000-0000-0000-000000000002','Synthetic');
insert into public.organization_members(organization_id,user_id,role) values ('18600000-0000-0000-0000-000000000002','18600000-0000-0000-0000-000000000001','owner');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method) values ('18600000-0000-0000-0000-000000000003','dynamic','http://localhost/callback','authorization_code','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values ('18600000-0000-0000-0000-000000000004','18600000-0000-0000-0000-000000000001','18600000-0000-0000-0000-000000000003','openid');
insert into private.mcp_reauth_proofs(user_id,client_id,consent_granted_at,verified_at) select user_id,client_id,granted_at,clock_timestamp() from auth.oauth_consents where id='18600000-0000-0000-0000-000000000004';
insert into auth.sessions(id,user_id,oauth_client_id,created_at) values ('18600000-0000-0000-0000-000000000005','18600000-0000-0000-0000-000000000001','18600000-0000-0000-0000-000000000003',now());
insert into public.clients(id,organization_id,name) values ('18600000-0000-0000-0000-000000000006','18600000-0000-0000-0000-000000000002','Synthetic');
insert into public.shifts(id,organization_id,client_id,start_at,end_at,status) values
('18600000-0000-0000-0000-000000000007','18600000-0000-0000-0000-000000000002','18600000-0000-0000-0000-000000000006','2026-10-28 01:00+00','2026-10-28 02:00+00','published'),
('18600000-0000-0000-0000-000000000008','18600000-0000-0000-0000-000000000002','18600000-0000-0000-0000-000000000006','2026-10-28 03:00+00','2026-10-28 04:00+00','published'),
('18600000-0000-0000-0000-000000000009','18600000-0000-0000-0000-000000000002','18600000-0000-0000-0000-000000000006','2026-10-28 05:00+00','2026-10-28 06:00+00','cancelled');
insert into public.shift_segments(id,shift_id,start_at,end_at) values ('18600000-0000-0000-0000-000000000010','18600000-0000-0000-0000-000000000008','2026-10-28 03:00+00','2026-10-28 04:00+00');
insert into public.reports(id,client_id,helper_id,service_date,status,shift_id) values ('18600000-0000-0000-0000-000000000011','18600000-0000-0000-0000-000000000006','18600000-0000-0000-0000-000000000001','2026-10-28','approved','18600000-0000-0000-0000-000000000008');
insert into public.report_shifts(report_id,shift_id,is_primary) values ('18600000-0000-0000-0000-000000000011','18600000-0000-0000-0000-000000000008',true);
set local role mcp_import;
select set_config('request.jwt.claims','{"sub":"18600000-0000-0000-0000-000000000001","role":"mcp_import","exp":4102444800,"client_id":"18600000-0000-0000-0000-000000000003","session_id":"18600000-0000-0000-0000-000000000005"}',true);
select throws_ok($$select public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000002','2026-10-28','2026-10-28')$$,'42501','mcp_record_read_unavailable','record switch defaults off');
reset role;
insert into private.mcp_record_read_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('18600000-0000-0000-0000-000000000002',true,'{}','18600000-0000-0000-0000-000000000001',now());
set local role mcp_import;
select throws_ok($$select public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000002','2026-10-28','2026-10-28')$$,'42501','mcp_shift_read_unavailable','shift switch defaults off');
reset role;
insert into private.mcp_shift_read_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('18600000-0000-0000-0000-000000000002',true,'{}','18600000-0000-0000-0000-000000000001',now());
set local role mcp_import;
select is(jsonb_array_length(public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000002','2026-10-28','2026-10-28')->'shifts'),2,'unlinked shift and uncovered segment listed, cancelled excluded');
select is(public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000002','2026-10-28','2026-10-28')->'shifts'->0->>'no_linked_record','true','unlinked shift identified');
select is(public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000002','2026-10-28','2026-10-28')->'shifts'->1->>'uncovered_segment','true','uncovered segment identified');
select is(public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000002','2026-10-28','2026-10-28',1)->>'has_more','true','page reports remaining candidates');
select throws_ok($$select public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000099','2026-10-28','2026-10-28')$$,'42501','mcp_record_read_unavailable','other organization denied');
select throws_ok($$select public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000002','2026-10-28','2026-10-28',21)$$,'22023','invalid_billing_review_query','page size bounded');
reset role;
update public.organization_members set role='member' where organization_id='18600000-0000-0000-0000-000000000002' and user_id='18600000-0000-0000-0000-000000000001';
insert into public.organization_roles(id,organization_id,name,permissions) values ('18600000-0000-0000-0000-000000000012','18600000-0000-0000-0000-000000000002','Synthetic assigned','{"records":{"view":"assigned"},"shifts":{"view":"all"}}');
insert into public.organization_member_roles(organization_id,user_id,role_id) values ('18600000-0000-0000-0000-000000000002','18600000-0000-0000-0000-000000000001','18600000-0000-0000-0000-000000000012');
set local role mcp_import;
select throws_ok($$select public.list_mcp_unrecorded_shifts('18600000-0000-0000-0000-000000000002','2026-10-28','2026-10-28')$$,'42501','mcp_billing_review_unavailable','partial record visibility denied');
reset role;
select ok(not has_function_privilege('authenticated','public.list_mcp_unrecorded_shifts(uuid,date,date,integer,integer)','execute'),'browser cannot call MCP RPC directly');
select * from finish();
rollback;
