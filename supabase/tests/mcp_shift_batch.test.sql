begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(16);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values ('18100000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp181@example.invalid','x',now(),now());
insert into public.organizations(id,name) values ('18100000-0000-0000-0000-000000000002','Synthetic');
insert into public.organization_members(organization_id,user_id,role) values ('18100000-0000-0000-0000-000000000002','18100000-0000-0000-0000-000000000001','owner');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method) values ('18100000-0000-0000-0000-000000000003','dynamic','http://localhost/callback','authorization_code','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values ('18100000-0000-0000-0000-000000000004','18100000-0000-0000-0000-000000000001','18100000-0000-0000-0000-000000000003','openid');
insert into private.mcp_reauth_proofs(user_id,client_id,consent_granted_at,verified_at) select user_id,client_id,granted_at,clock_timestamp() from auth.oauth_consents where id='18100000-0000-0000-0000-000000000004';
insert into auth.sessions(id,user_id,oauth_client_id,created_at) values ('18100000-0000-0000-0000-000000000005','18100000-0000-0000-0000-000000000001','18100000-0000-0000-0000-000000000003',now());
insert into public.clients(id,organization_id,name) values ('18100000-0000-0000-0000-000000000006','18100000-0000-0000-0000-000000000002','Synthetic client');
insert into public.staffs(id,organization_id,name) values ('18100000-0000-0000-0000-000000000007','18100000-0000-0000-0000-000000000002','Synthetic staff');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values ('18100000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-recipient@example.invalid','x',now(),now());
insert into public.organization_members(organization_id,user_id,role) values ('18100000-0000-0000-0000-000000000002','18100000-0000-0000-0000-000000000009','member');
update public.staffs set user_id='18100000-0000-0000-0000-000000000009' where id='18100000-0000-0000-0000-000000000007';

insert into public.shifts(id,organization_id,client_id,start_at,end_at,status) values ('18100000-0000-0000-0000-000000000008','18100000-0000-0000-0000-000000000002','18100000-0000-0000-0000-000000000006','2026-11-01 00:00+00','2026-11-01 01:00+00','published');
insert into private.mcp_shift_read_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('18100000-0000-0000-0000-000000000002',true,'{}','18100000-0000-0000-0000-000000000001',now());
insert into private.mcp_person_search_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('18100000-0000-0000-0000-000000000002',true,'{}','18100000-0000-0000-0000-000000000001',now());
select set_config('request.jwt.claims','{"sub":"18100000-0000-0000-0000-000000000001","role":"mcp_import","exp":4102444800,"client_id":"18100000-0000-0000-0000-000000000003","session_id":"18100000-0000-0000-0000-000000000005"}',true);
insert into private.mcp_shift_update_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('18100000-0000-0000-0000-000000000002',true,'{}','18100000-0000-0000-0000-000000000001',now());
insert into public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at) values ('mcp180-browser','mcp180-browser','18100000-0000-0000-0000-000000000001',now(),now()+interval '1 hour');
set constraints all immediate;
set constraints all deferred;
insert into public.shifts(id,organization_id,client_id,start_at,end_at,status) values
 ('18100000-0000-0000-0000-000000000010','18100000-0000-0000-0000-000000000002','18100000-0000-0000-0000-000000000006','2026-11-01 08:00+00','2026-11-01 09:00+00','published');
select set_config('test.batch',public.prepare_mcp_shift_update_batch('18100000-0000-0000-0000-000000000002',
 '[{"shift_id":"18100000-0000-0000-0000-000000000008","start_at":"2026-11-01T02:00:00Z","end_at":"2026-11-01T03:00:00Z","segments":[{"start_at":"2026-11-01T02:00:00Z","end_at":"2026-11-01T03:00:00Z","staffs":[{"staff_id":"18100000-0000-0000-0000-000000000007"}]}]},{"shift_id":"18100000-0000-0000-0000-000000000010","start_at":"2026-11-01T10:00:00Z","end_at":"2026-11-01T11:00:00Z","segments":[{"start_at":"2026-11-01T10:00:00Z","end_at":"2026-11-01T11:00:00Z","staffs":[{"staff_id":"18100000-0000-0000-0000-000000000007"}]}]}]'::jsonb)->>'batch_id',true);
select ok(not has_function_privilege('mcp_import','public.confirm_mcp_shift_update_batch(uuid,uuid[])','execute'),'MCP cannot confirm a batch');
select is((select start_at from public.shifts where id='18100000-0000-0000-0000-000000000008'),'2026-11-01 00:00+00'::timestamptz,'preparing does not change shifts');
select throws_ok($$select public.confirm_mcp_shift_update_batch(current_setting('test.batch')::uuid,array[(select proposal_id from private.mcp_shift_update_batch_items where batch_id=current_setting('test.batch')::uuid and position=1)])$$,'42501','proposal_unavailable','OAuth cannot confirm');
select set_config('request.jwt.claims','{"sub":"18100000-0000-0000-0000-000000000001","role":"authenticated","session_id":"mcp180-browser"}',true);
select is(jsonb_array_length(public.get_mcp_shift_update_batch(current_setting('test.batch')::uuid)->'items'),2,'browser sees both proposals');
select is(public.confirm_mcp_shift_update_batch(current_setting('test.batch')::uuid,array[(select proposal_id from private.mcp_shift_update_batch_items where batch_id=current_setting('test.batch')::uuid and position=1)])->'items'->0->>'status','updated','selected proposal is updated');
select is((select start_at from public.shifts where id='18100000-0000-0000-0000-000000000008'),'2026-11-01 02:00+00'::timestamptz,'selected change applied');
select is((select start_at from public.shifts where id='18100000-0000-0000-0000-000000000010'),'2026-11-01 08:00+00'::timestamptz,'unselected change not applied');
select throws_ok($$select public.confirm_mcp_shift_update_batch(current_setting('test.batch')::uuid,array['18100000-0000-0000-0000-000000000099'::uuid])$$,'42501','proposal_unavailable','proposal outside batch is rejected');
select is((select count(*) from public.audit_events where action_type='shift.update' and resource_id='18100000-0000-0000-0000-000000000008'),1::bigint,'selected change is audited');
insert into public.shifts(id,organization_id,client_id,start_at,end_at,status) values
 ('18100000-0000-0000-0000-000000000011','18100000-0000-0000-0000-000000000002','18100000-0000-0000-0000-000000000006','2026-11-01 10:15+00','2026-11-01 10:45+00','published');
select is(public.confirm_mcp_shift_update_batch(current_setting('test.batch')::uuid,array[(select proposal_id from private.mcp_shift_update_batch_items where batch_id=current_setting('test.batch')::uuid and position=2)])->'items'->0->>'status','shift_conflict','conflict is reported for the selected proposal');
select is((select start_at from public.shifts where id='18100000-0000-0000-0000-000000000010'),'2026-11-01 08:00+00'::timestamptz,'conflicted change is not applied');
select is((select count(*) from public.audit_events where action_type='shift.update' and resource_id='18100000-0000-0000-0000-000000000010'),0::bigint,'conflict does not create success audit');
select is((select jsonb_agg(x->>'status') from jsonb_array_elements(public.confirm_mcp_shift_update_batch(current_setting('test.batch')::uuid,
 array(select proposal_id from private.mcp_shift_update_batch_items where batch_id=current_setting('test.batch')::uuid order by position))->'items') x),
 '["updated", "shift_conflict"]'::jsonb,'mixed success and failure are reported separately');
select is((select count(*) from public.audit_events where action_type='shift.update' and resource_id='18100000-0000-0000-0000-000000000008'),1::bigint,'replayed success does not duplicate audit');
update private.mcp_shift_update_controls set enabled=false where organization_id='18100000-0000-0000-0000-000000000002';
select throws_ok($$select public.confirm_mcp_shift_update_batch(current_setting('test.batch')::uuid,array[(select proposal_id from private.mcp_shift_update_batch_items where batch_id=current_setting('test.batch')::uuid and position=2)])$$,'42501','proposal_unavailable','disabled organization control rejects confirmation');
update private.mcp_shift_update_controls set enabled=true where organization_id='18100000-0000-0000-0000-000000000002';
update auth.oauth_consents set revoked_at=clock_timestamp() where id='18100000-0000-0000-0000-000000000004';
select throws_ok($$select public.confirm_mcp_shift_update_batch(current_setting('test.batch')::uuid,array[(select proposal_id from private.mcp_shift_update_batch_items where batch_id=current_setting('test.batch')::uuid and position=2)])$$,'42501','proposal_unavailable','revoked OAuth rejects confirmation');
select * from finish();
rollback;
