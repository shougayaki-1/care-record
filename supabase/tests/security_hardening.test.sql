BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT plan(63);

SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'),
  'all public tables have RLS enabled');
SELECT ok(NOT has_table_privilege('anon','public.invitations','SELECT'), 'anonymous cannot list invitations');
SELECT is((
  SELECT count(*)::bigint
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND (
      has_table_privilege('anon', c.oid, 'SELECT')
      OR has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE')
    )
), 0::bigint, 'anonymous has no direct DML privilege on public tables');
SELECT is((
  SELECT count(*)::bigint
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname <> 'get_invitation_preview'
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
), 0::bigint, 'anonymous cannot execute public RPCs other than invitation preview');
SELECT ok(has_function_privilege('anon','public.get_invitation_preview(text)','EXECUTE'),
  'anonymous may execute only the bounded invitation preview RPC');
SELECT is((
  SELECT count(*)::bigint
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee = 'authenticated'
    AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
), 0::bigint, 'authenticated clients have no maintenance or DDL-adjacent table privileges');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"test-session"}', true);
SELECT throws_ok(
  $$ INSERT INTO public.invitations (organization_id, code, email, target_name, expires_at)
     VALUES ('00000000-0000-0000-0000-000000000002', 'blocked1', 'blocked@example.invalid', 'blocked', now() + interval '1 hour') $$,
  '42501', 'new row violates row-level security policy for table "invitations"',
  'clients without an active authorized tenant session cannot create invitations directly');
SELECT throws_ok(
  $$ INSERT INTO public.organization_members (organization_id, user_id, role)
     VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'member') $$,
  '42501', 'new row violates row-level security policy for table "organization_members"',
  'clients without an active authorized tenant session cannot add organization members directly');
RESET ROLE;
SELECT ok(NOT has_table_privilege('authenticated','public.reports','UPDATE'), 'clients cannot update reports directly');
SELECT ok(NOT has_table_privilege('authenticated','public.shifts','DELETE'), 'clients cannot hard-delete shifts');
SELECT ok(has_function_privilege('authenticated','public.save_report_atomic(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,uuid,jsonb)','EXECUTE'),
  'authenticated users retain the legacy report RPC until external-use review completes');
SELECT ok(NOT has_function_privilege('anon','public.save_report_atomic(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,uuid,jsonb)','EXECUTE'),
  'anonymous users cannot call the report RPC');
SELECT has_trigger('public','audit_events','audit_events_chain_insert','audit events are hash chained');
SELECT has_trigger('public','audit_events','audit_events_no_update','audit events are append only');
SELECT col_is_pk('public','user_session_activity','session_hash','session activity is keyed by token hash');

SELECT ok((
  SELECT count(*) = 15
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = 'Authenticated read base'
    AND permissive = 'PERMISSIVE'
    AND cmd = 'SELECT'
), 'operational tables have an explicit permissive SELECT base');
SELECT ok((
  SELECT count(*) >= 15
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = 'Require active server session'
    AND permissive = 'RESTRICTIVE'
    AND cmd = 'SELECT'
), 'operational tables require an active server session');
SELECT ok((
  SELECT count(*) >= 14
  FROM pg_policies
  WHERE schemaname = 'public'
    AND permissive = 'RESTRICTIVE'
    AND cmd = 'SELECT'
    AND policyname IN (
      'Tenant boundary organizations', 'Tenant boundary members', 'Tenant boundary clients',
      'Tenant boundary staffs', 'Tenant boundary reports', 'Tenant boundary report values',
      'Tenant boundary report images', 'Tenant boundary form templates', 'Tenant boundary shifts',
      'Tenant boundary shift staffs', 'Tenant boundary shift patterns',
      'Tenant boundary shift pattern staffs', 'Tenant boundary assignments',
      'Own notifications only', 'Profile directory boundary'
    )
), 'tenant and per-user restrictive policies remain enabled');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"test-session"}', true);
SELECT is((SELECT count(*)::bigint FROM public.invitations), 0::bigint,
  'authenticated clients without an active tenant session cannot list invitations');
RESET ROLE;

SELECT ok(NOT has_table_privilege('authenticated','public.report_autosaves','SELECT,INSERT,UPDATE,DELETE'),
  'authenticated clients cannot access report autosaves directly');
SELECT ok(NOT has_table_privilege('authenticated','public.reports','INSERT'),
  'authenticated clients cannot directly INSERT reports, so INSERT RETURNING is not an application path');
SELECT ok(NOT has_table_privilege('authenticated','public.google_sync_runs','SELECT,INSERT,UPDATE,DELETE'),
  'authenticated clients cannot access Google sync runs directly');
SELECT ok(NOT has_table_privilege('authenticated','public.maintenance_runs','SELECT,INSERT,UPDATE,DELETE'),
  'authenticated clients cannot access maintenance runs directly');
SELECT ok(NOT has_table_privilege('authenticated','public.maintenance_run_items','SELECT,INSERT,UPDATE,DELETE'),
  'authenticated clients cannot access maintenance run items directly');
SELECT ok(has_table_privilege('service_role','public.report_autosaves','SELECT,INSERT,UPDATE,DELETE'),
  'service role retains report autosave access');
SELECT ok((
  SELECT with_check LIKE '%get_member_record_action_scope%create%all%'
     AND with_check LIKE '%get_member_record_action_scope%create%assigned%'
     AND with_check LIKE '%is_assigned_client_for_user%'
  FROM pg_policies WHERE schemaname='public' AND tablename='reports' AND policyname='Create reports'
), 'report INSERT policy enforces all or assigned records.create scope');
SELECT ok((
  SELECT with_check LIKE '%get_member_record_action_scope%create%all%'
     AND with_check LIKE '%get_member_record_action_scope%create%assigned%'
     AND with_check LIKE '%is_assigned_client_for_user%'
  FROM pg_policies WHERE schemaname='public' AND tablename='report_images' AND policyname='Enable insert for staff'
), 'report image INSERT policy enforces all or assigned records.create scope');

SELECT is(private.database_capacity_status(299 * 1024 * 1024)->>'level', 'normal',
  'database capacity is normal below 300 MiB');
SELECT is(private.database_capacity_status(300 * 1024 * 1024)->>'level', 'warning',
  'database capacity warns at 300 MiB');
SELECT is(private.database_capacity_status(400 * 1024 * 1024)->>'level', 'restricted',
  'database capacity restricts organization creation and bulk imports at 400 MiB');
SELECT is(private.database_capacity_status(450 * 1024 * 1024)->>'level', 'critical',
  'database capacity is critical at 450 MiB');
SELECT ok((private.database_capacity_status(399 * 1024 * 1024)->>'allowNewOrganizations')::boolean,
  'new organizations remain allowed below 400 MiB');
SELECT ok(NOT (private.database_capacity_status(400 * 1024 * 1024)->>'allowNewOrganizations')::boolean,
  'new organizations are blocked at 400 MiB');
SELECT ok((private.database_capacity_status(449 * 1024 * 1024)->>'allowNewReports')::boolean,
  'new reports remain allowed below 450 MiB');
SELECT ok(NOT (private.database_capacity_status(450 * 1024 * 1024)->>'allowNewReports')::boolean,
  'new reports are blocked at 450 MiB');
SELECT throws_ok(
  $$ SELECT private.enforce_database_capacity('new_organization', 400 * 1024 * 1024) $$,
  'P0001', 'database_capacity_blocks_new_organization',
  'organization capacity guard rejects writes at 400 MiB');
SELECT throws_ok(
  $$ SELECT private.enforce_database_capacity('new_report', 450 * 1024 * 1024) $$,
  'P0001', 'database_capacity_blocks_new_report',
  'new report capacity guard rejects writes at 450 MiB');
SELECT ok(NOT has_function_privilege('authenticated','public.get_database_capacity_status()','EXECUTE'),
  'database capacity details are not exposed to authenticated clients');

-- 20260716000019: authenticated の INSERT ... RETURNING（supabase-js の .insert().select()）が
-- 自己参照 RESTRICTIVE ポリシーで拒否されない回帰テスト。テナント境界は維持されること。
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('e2e00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-owner@example.invalid', 'x', now(), now(), now()),
  ('e2e00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-outsider@example.invalid', 'x', now(), now(), now());
INSERT INTO public.profiles (id, name) VALUES
  ('e2e00000-0000-0000-0000-000000000001', 'RLS Owner'),
  ('e2e00000-0000-0000-0000-000000000002', 'RLS Outsider')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.organizations (id, name) VALUES ('e2e00000-0000-0000-0000-00000000000a', 'RLS Fixture Org');
INSERT INTO public.organization_members (organization_id, user_id, role)
VALUES ('e2e00000-0000-0000-0000-00000000000a', 'e2e00000-0000-0000-0000-000000000001', 'owner');
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('e2e00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'accounts-manager@example.invalid', 'x', now(), now(), now());
INSERT INTO public.profiles (id, name) VALUES
  ('e2e00000-0000-0000-0000-000000000003', 'Accounts Manager')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.organization_members (organization_id, user_id, role)
VALUES ('e2e00000-0000-0000-0000-00000000000a', 'e2e00000-0000-0000-0000-000000000003', 'member');
INSERT INTO public.organization_roles (id, organization_id, name, color, is_preset, permissions)
VALUES
  ('e2e00000-0000-0000-0000-00000000000c', 'e2e00000-0000-0000-0000-00000000000a', 'Accounts manager', '#000000', false, '{"management":{"accounts":true}}'::jsonb),
  ('e2e00000-0000-0000-0000-00000000000d', 'e2e00000-0000-0000-0000-00000000000a', 'Safe invitee role', '#000000', false, '{"management":{}}'::jsonb),
  ('e2e00000-0000-0000-0000-00000000000e', 'e2e00000-0000-0000-0000-00000000000a', 'Dangerous invitee role', '#000000', false, '{"management":{"roles":true}}'::jsonb);
INSERT INTO public.organization_member_roles (organization_id, user_id, role_id)
VALUES ('e2e00000-0000-0000-0000-00000000000a', 'e2e00000-0000-0000-0000-000000000003', 'e2e00000-0000-0000-0000-00000000000c');
INSERT INTO public.user_session_activity (session_hash, auth_session_id, user_id, last_activity, absolute_expires_at) VALUES
  ('rls-owner-hash', 'rls-owner-session', 'e2e00000-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('rls-outsider-hash', 'rls-outsider-session', 'e2e00000-0000-0000-0000-000000000002', now(), now() + interval '1 hour'),
  ('accounts-manager-hash', 'accounts-manager-session', 'e2e00000-0000-0000-0000-000000000003', now(), now() + interval '1 hour');
INSERT INTO public.clients (id, organization_id, name)
VALUES ('e2e00000-0000-0000-0000-00000000000b', 'e2e00000-0000-0000-0000-00000000000a', 'RLS Fixture Client');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"e2e00000-0000-0000-0000-000000000001","role":"authenticated","session_id":"rls-owner-session"}', true);
SELECT lives_ok(
  $$ INSERT INTO public.clients (organization_id, name)
     VALUES ('e2e00000-0000-0000-0000-00000000000a', 'RETURNING Client')
     RETURNING id, name $$,
  'org owner can INSERT clients with RETURNING (insert().select())');
SELECT lives_ok(
  $$ INSERT INTO public.shifts (organization_id, client_id, title, start_at, end_at, status)
     VALUES ('e2e00000-0000-0000-0000-00000000000a', 'e2e00000-0000-0000-0000-00000000000b', 'RETURNING Shift', now(), now() + interval '1 hour', 'published')
     RETURNING id $$,
  'org owner can INSERT shifts with RETURNING (insert().select())');

-- Regression: the public invitation RPC is SECURITY DEFINER and callable by
-- authenticated users. It must therefore enforce the same dangerous-role
-- owner rule as the Server Action, even when called directly through RPC.
SELECT set_config('request.jwt.claims', '{"sub":"e2e00000-0000-0000-0000-000000000003","role":"authenticated","session_id":"accounts-manager-session"}', true);
SELECT lives_ok(
  $$ SELECT public.create_invitation_authorized(
       'e2e00000-0000-0000-0000-00000000000a', 'safeinvite1', 'safe-invite@example.invalid', 'Safe invitee',
       ARRAY['e2e00000-0000-0000-0000-00000000000d']::uuid[], NULL) $$,
  'accounts manager can invite a member with a non-dangerous role');
SELECT throws_ok(
  $$ SELECT public.create_invitation_authorized(
       'e2e00000-0000-0000-0000-00000000000a', 'dangerous1', 'dangerous-invite@example.invalid', 'Dangerous invitee',
       ARRAY['e2e00000-0000-0000-0000-00000000000e']::uuid[], NULL) $$,
  '42501', 'owner_required',
  'accounts manager cannot invite a member with a dangerous role through direct RPC');
SELECT throws_ok(
  $$ SELECT public.create_invitation_authorized(
       'e2e00000-0000-0000-0000-00000000000a', 'foreignrole', 'foreign-role@example.invalid', 'Foreign role',
       ARRAY['00000000-0000-0000-0000-000000000001']::uuid[], NULL) $$,
  'P0001', 'invalid_role_ids',
  'invitation rejects role IDs from another organization');
SELECT set_config('request.jwt.claims', '{"sub":"e2e00000-0000-0000-0000-000000000001","role":"authenticated","session_id":"rls-owner-session"}', true);
SELECT lives_ok(
  $$ SELECT public.create_invitation_authorized(
       'e2e00000-0000-0000-0000-00000000000a', 'ownerinvite', 'owner-invite@example.invalid', 'Owner invitee',
       ARRAY['e2e00000-0000-0000-0000-00000000000e']::uuid[], NULL) $$,
  'owner can invite a member with a dangerous role');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.create_invitation_authorized(uuid,text,text,text,uuid[],uuid)', 'EXECUTE'),
  'anonymous users cannot call the invitation creation RPC');
SELECT ok(has_function_privilege('authenticated', 'public.save_report_versioned(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,bigint,uuid,text,uuid,jsonb,text)', 'EXECUTE'),
  'authenticated users may call the versioned report contract RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.save_report_versioned(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,bigint,uuid,text,uuid,jsonb,text)', 'EXECUTE'),
  'anonymous users cannot call the versioned report contract RPC');
SELECT ok(has_function_privilege('authenticated', 'public.save_generated_shift_atomic(uuid,uuid,jsonb)', 'EXECUTE'),
  'authenticated users may call the generated-shift contract RPC');
SELECT ok(has_function_privilege('authenticated', 'public.create_shift_with_segments_atomic(uuid,jsonb)', 'EXECUTE'),
  'authenticated users may call the atomic shift creation RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.transfer_owner_atomic(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous users cannot call the owner-transfer contract RPC');

-- GAP-01: シフト時刻変更・キャンセル切替・フィールド更新・単体削除の atomic RPC。
-- 影響行数(ROW_COUNT)で成功を確認するための RPC で、authenticated には実行権限を
-- 付与しつつ PUBLIC/anon には一切許可しない（既存 atomic RPC と同じ契約）。
SELECT ok(has_function_privilege('authenticated', 'public.update_shift_time_atomic(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE'),
  'authenticated users may call the shift time-update atomic RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.update_shift_time_atomic(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE'),
  'anonymous users cannot call the shift time-update atomic RPC');
SELECT ok(has_function_privilege('authenticated', 'public.toggle_cancel_shift_atomic(uuid,uuid,boolean,text)', 'EXECUTE'),
  'authenticated users may call the shift cancel-toggle atomic RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.toggle_cancel_shift_atomic(uuid,uuid,boolean,text)', 'EXECUTE'),
  'anonymous users cannot call the shift cancel-toggle atomic RPC');
SELECT ok(has_function_privilege('authenticated', 'public.update_shift_fields_atomic(uuid,uuid,jsonb)', 'EXECUTE'),
  'authenticated users may call the shift field-update atomic RPC');
SELECT ok(has_function_privilege('authenticated', 'public.delete_shift_atomic(uuid,uuid,text,timestamptz,text)', 'EXECUTE'),
  'authenticated users may call the single shift-delete atomic RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.delete_shift_atomic(uuid,uuid,text,timestamptz,text)', 'EXECUTE'),
  'anonymous users cannot call the single shift-delete atomic RPC');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"e2e00000-0000-0000-0000-000000000001","role":"authenticated","session_id":"rls-owner-session"}', true);

-- Regression: mutate_organization_role_authorized's last-role-manager safety check
-- must count an organization owner as a role manager even with no explicit
-- organization_member_roles link (the state of every freshly created organization).
-- 'e2e00000-...00001' is only linked via organization_members.role='owner' above.
SELECT lives_ok(
  $$ SELECT public.mutate_organization_role_authorized(
       'e2e00000-0000-0000-0000-00000000000a'::uuid, NULL, 'create', 'Regression Role', '#ffffff',
       '{"management":{}}'::jsonb, false) $$,
  'org owner with no explicit role link can create a role (last_role_manager owner fix)');

SELECT set_config('request.jwt.claims', '{"sub":"e2e00000-0000-0000-0000-000000000002","role":"authenticated","session_id":"rls-outsider-session"}', true);
SELECT is((SELECT count(*)::bigint FROM public.clients WHERE organization_id = 'e2e00000-0000-0000-0000-00000000000a'), 0::bigint,
  'non-members still cannot read another org''s clients');
SELECT is((SELECT count(*)::bigint FROM public.shifts WHERE organization_id = 'e2e00000-0000-0000-0000-00000000000a'), 0::bigint,
  'non-members still cannot read another org''s shifts');
SELECT throws_ok(
  $$ INSERT INTO public.clients (organization_id, name)
     VALUES ('e2e00000-0000-0000-0000-00000000000a', 'Intruder Client') $$,
  '42501', 'new row violates row-level security policy for table "clients"',
  'non-members still cannot INSERT clients into another org');
RESET ROLE;

SELECT ok(has_function_privilege('authenticated','public.current_user_has_password()','EXECUTE'),
  'authenticated users can check their own password status for SSO step-up reauth');
SELECT ok(NOT has_function_privilege('anon','public.current_user_has_password()','EXECUTE'),
  'anonymous cannot check password status');

SELECT * FROM finish();
ROLLBACK;
