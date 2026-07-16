BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT plan(37);

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
  'authenticated users may call the bounded report RPC');
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

SELECT * FROM finish();
ROLLBACK;
