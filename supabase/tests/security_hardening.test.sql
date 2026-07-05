BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'),
  'all public tables have RLS enabled');
SELECT ok(NOT has_table_privilege('anon','public.invitations','SELECT'), 'anonymous cannot list invitations');
SELECT ok(NOT has_table_privilege('anon','public.offices','SELECT'), 'anonymous cannot list offices');
SELECT ok(NOT has_table_privilege('authenticated','public.invitations','INSERT'), 'clients cannot create invitations directly');
SELECT ok(NOT has_table_privilege('authenticated','public.organization_members','INSERT'), 'clients cannot add organization members directly');
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
  SELECT count(*) = 15
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
SELECT ok(NOT has_table_privilege('authenticated','public.invitations','SELECT'),
  'authenticated clients cannot list invitations directly');

SELECT * FROM finish();
ROLLBACK;
