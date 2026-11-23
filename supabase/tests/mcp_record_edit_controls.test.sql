begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(13);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('18510000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','record-edit-owner@example.invalid','x',now(),now()),
('18510000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','record-edit-member@example.invalid','x',now(),now());
insert into public.organizations(id,name) values ('18510000-0000-0000-0000-000000000003','Synthetic');
insert into public.organization_members(organization_id,user_id,role) values
('18510000-0000-0000-0000-000000000003','18510000-0000-0000-0000-000000000001','owner'),
('18510000-0000-0000-0000-000000000003','18510000-0000-0000-0000-000000000002','member');
insert into public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at) values
('record-edit-owner','record-edit-owner','18510000-0000-0000-0000-000000000001',now(),now()+interval '1 hour'),
('record-edit-member','record-edit-member','18510000-0000-0000-0000-000000000002',now(),now()+interval '1 hour');
select ok(not has_function_privilege('mcp_import','public.enable_mcp_record_edit(uuid,jsonb)','execute'),'MCP cannot enable record edit');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"18510000-0000-0000-0000-000000000002","role":"authenticated","session_id":"record-edit-member"}',true);
select throws_ok($$select public.enable_mcp_record_edit('18510000-0000-0000-0000-000000000003','{"provider":"a","processing":"b","region":"c","retention":"d","secondary_use":"e","notice":"f"}')$$,'42501','permission_denied','member cannot enable');
select set_config('request.jwt.claims','{"sub":"18510000-0000-0000-0000-000000000001","role":"authenticated","session_id":"record-edit-owner"}',true);
select is(public.get_mcp_record_edit_control('18510000-0000-0000-0000-000000000003')->>'enabled','false','default off');
select throws_ok($$select public.enable_mcp_record_edit('18510000-0000-0000-0000-000000000003','{}')$$,'22023','invalid_mcp_conditions','missing conditions rejected');
select lives_ok($$select public.enable_mcp_record_edit('18510000-0000-0000-0000-000000000003','{"provider":"a","processing":"b","region":"c","retention":"d","secondary_use":"e","notice":"f"}')$$,'owner enables with conditions');
select is(public.get_mcp_record_edit_control('18510000-0000-0000-0000-000000000003')->>'enabled','true','enabled state is readable');
select lives_ok($$select public.disable_mcp_record_edit('18510000-0000-0000-0000-000000000003')$$,'owner can disable');
reset role;
select is((select enabled from private.mcp_record_edit_controls where organization_id='18510000-0000-0000-0000-000000000003'),false,'switch disabled');
select is((select count(*)::int from public.audit_events where organization_id='18510000-0000-0000-0000-000000000003' and action_type in ('integration.mcp_record_edit.enable','integration.mcp_record_edit.disable') and not (details ? 'conditions')),2,'both operations audited without condition text');
savepoint deleted_org;
update public.organizations set deleted_at=clock_timestamp() where id='18510000-0000-0000-0000-000000000003';
set local role authenticated;
select throws_ok($$select public.get_mcp_record_edit_control('18510000-0000-0000-0000-000000000003')$$,'42501','permission_denied','deleted organization settings are hidden');
reset role;
rollback to savepoint deleted_org;
savepoint revoked_browser;
update public.user_session_activity set revoked_at=clock_timestamp() where auth_session_id='record-edit-owner';
set local role authenticated;
select throws_ok($$select public.disable_mcp_record_edit('18510000-0000-0000-0000-000000000003')$$,'42501','authentication_required','revoked browser cannot change setting');
reset role;
rollback to savepoint revoked_browser;
create function public.mcp182_control_fail_audit() returns trigger language plpgsql set search_path='' as $$begin if new.action_type='integration.mcp_record_edit.enable' then raise exception 'fixture_audit_failed'; end if; return new; end$$;
create trigger mcp182_control_fail_audit before insert on public.audit_events for each row execute function public.mcp182_control_fail_audit();
set local role authenticated;
select throws_ok($$select public.enable_mcp_record_edit('18510000-0000-0000-0000-000000000003','{"provider":"a","processing":"b","region":"c","retention":"d","secondary_use":"e","notice":"f"}')$$,'P0001','fixture_audit_failed','audit failure rejects enable');
reset role;
select is((select enabled from private.mcp_record_edit_controls where organization_id='18510000-0000-0000-0000-000000000003'),false,'audit failure rolls back enable');
select * from finish();
rollback;
