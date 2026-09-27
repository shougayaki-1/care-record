begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('d1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-review-manager@example.invalid', 'x', now(), now(), now()),
  ('d2222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-review-staff@example.invalid', 'x', now(), now(), now());
insert into public.profiles (id, name) values
  ('d1111111-0000-0000-0000-000000000001', 'AI reviewer'),
  ('d2222222-0000-0000-0000-000000000002', 'AI sender')
on conflict (id) do update set name = excluded.name;
insert into public.organizations (id, name) values ('dddddddd-0000-0000-0000-000000000001', 'AI review test');
insert into public.organization_members (organization_id, user_id, role) values
  ('dddddddd-0000-0000-0000-000000000001', 'd1111111-0000-0000-0000-000000000001', 'owner'),
  ('dddddddd-0000-0000-0000-000000000001', 'd2222222-0000-0000-0000-000000000002', 'member');
insert into public.clients (id, organization_id, name) values
  ('d4444444-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000001', 'AI test client');
insert into public.staffs (id, organization_id, name, user_id) values
  ('d3333333-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001', 'AI test staff', 'd2222222-0000-0000-0000-000000000002');
insert into public.ai_import_candidates (id, organization_id, created_by, source_file_name, payload) values
  ('d5555555-0000-0000-0000-000000000005', 'dddddddd-0000-0000-0000-000000000001', 'd2222222-0000-0000-0000-000000000002', 'source.pdf', '{"meta":{},"values":{},"warnings":[],"confidence":"low"}'::jsonb);
insert into public.user_session_activity (session_hash, auth_session_id, user_id, last_activity, absolute_expires_at) values
  ('ai-manager-hash', 'ai-manager-session', 'd1111111-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('ai-staff-hash', 'ai-staff-session', 'd2222222-0000-0000-0000-000000000002', now(), now() + interval '1 hour');

set local role mcp_import;
select set_config('request.jwt.claims', '{"sub":"d2222222-0000-0000-0000-000000000002","role":"mcp_import","client_id":"ai-test-client"}', true);
do $$ begin
  if array_to_string(public.get_mcp_self_staff_names('dddddddd-0000-0000-0000-000000000001'), ',') <> 'AI test staff' then
    raise exception 'MCP could not read its own staff name';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"d1111111-0000-0000-0000-000000000001","role":"mcp_import","client_id":"ai-test-client"}', true);
do $$ begin
  if coalesce(array_length(public.get_mcp_self_staff_names('dddddddd-0000-0000-0000-000000000001'), 1), 0) <> 0 then
    raise exception 'MCP received another user staff name';
  end if;
end $$;
reset role;
select pass('MCP sees only the connected staff member name');
select pass('MCP does not receive the organization staff directory');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d2222222-0000-0000-0000-000000000002","role":"authenticated","session_id":"ai-staff-session"}', true);
select throws_ok($$
  select public.approve_ai_import_candidate(
    'dddddddd-0000-0000-0000-000000000001',
    'd5555555-0000-0000-0000-000000000005',
    'd4444444-0000-0000-0000-000000000004',
    'd3333333-0000-0000-0000-000000000003',
    '2026-09-27 09:00:00+09', '2026-09-27 10:00:00+09',
    '{}'::jsonb, 'none', 0, 'ai-staff-session'
  )
$$, '42501', 'permission_denied', 'the sender cannot approve the submission');
select set_config('request.jwt.claims', '{"sub":"d1111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"ai-manager-session"}', true);
select is((select count(*)::integer from public.ai_import_candidates where organization_id = 'dddddddd-0000-0000-0000-000000000001'), 1, 'manager sees a staff-submitted AI record');
select lives_ok($$
  select public.approve_ai_import_candidate(
    'dddddddd-0000-0000-0000-000000000001',
    'd5555555-0000-0000-0000-000000000005',
    'd4444444-0000-0000-0000-000000000004',
    'd3333333-0000-0000-0000-000000000003',
    '2026-09-27 09:00:00+09', '2026-09-27 10:00:00+09',
    '{"special_note":"verified"}'::jsonb, 'none', 0, 'ai-manager-session'
  )
$$, 'manager can approve the submitted AI record in one call');
reset role;

select is((select count(*)::integer from public.reports r join public.clients c on c.id = r.client_id
    where c.organization_id = 'dddddddd-0000-0000-0000-000000000001' and r.status = 'approved'), 1,
    'one approved report is created');
select is((select count(*)::integer from public.ai_import_candidates where id = 'd5555555-0000-0000-0000-000000000005'), 0,
    'approved item is removed from the review queue');
select is((select count(*)::integer from public.ai_import_provenance where candidate_id = 'd5555555-0000-0000-0000-000000000005'
    and submitted_by = 'd2222222-0000-0000-0000-000000000002' and reviewed_by = 'd1111111-0000-0000-0000-000000000001'), 1,
    'sender and reviewer are recorded');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"ai-manager-session"}', true);
select throws_ok($$
  select public.approve_ai_import_candidate(
    'dddddddd-0000-0000-0000-000000000001',
    'd5555555-0000-0000-0000-000000000005',
    'd4444444-0000-0000-0000-000000000004',
    'd3333333-0000-0000-0000-000000000003',
    '2026-09-27 09:00:00+09', '2026-09-27 10:00:00+09',
    '{}'::jsonb, 'none', 0, 'ai-manager-session'
  )
$$, 'P0002', 'candidate_not_found', 'a reviewed submission cannot create a second report');
reset role;
select * from finish();
rollback;
