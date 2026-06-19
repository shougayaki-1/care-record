-- Supabase SQL Editor 用: すべての診断結果を1つの結果表にまとめる読み取り専用SQL
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

WITH
rls_status AS (
  SELECT
    '03_rls_status'::text AS section,
    format('%I.%I', n.nspname, c.relname) AS object_name,
    CASE
      WHEN NOT c.relrowsecurity THEN 'FAIL'
      WHEN n.nspname = 'storage' AND count(p.polname) = 0 THEN 'INFO'
      WHEN count(p.polname) = 0 THEN 'WARN'
      ELSE 'PASS'
    END AS result,
    jsonb_build_object(
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'policy_count', count(p.polname),
      'note', CASE
        WHEN n.nspname = 'storage' AND count(p.polname) = 0
          THEN 'Supabase-managed default deny'
        WHEN count(p.polname) = 0 THEN 'default deny (no policy)'
      END
    ) AS details
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname IN ('public', 'storage')
    AND c.relkind IN ('r', 'p')
  GROUP BY n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
),
policy_status AS (
  SELECT
    '04_rls_policy'::text AS section,
    format('%I.%I / %s', schemaname, tablename, policyname) AS object_name,
    'INFO'::text AS result,
    jsonb_build_object(
      'permissive', permissive,
      'roles', roles,
      'command', cmd,
      'using', qual,
      'with_check', with_check
    ) AS details
  FROM pg_catalog.pg_policies
  WHERE schemaname IN ('public', 'storage')
),
grant_status AS (
  SELECT
    '05_table_grant'::text AS section,
    format('%I.%I / %s', table_schema, table_name, grantee) AS object_name,
    'INFO'::text AS result,
    jsonb_build_object(
      'privileges', string_agg(privilege_type, ', ' ORDER BY privilege_type)
    ) AS details
  FROM information_schema.table_privileges
  WHERE table_schema IN ('public', 'storage')
    AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  GROUP BY table_schema, table_name, grantee
),
expected_columns(schema_name, table_name, column_name) AS (
  VALUES
    ('public', 'audit_events', 'event_hash'),
    ('public', 'audit_events', 'previous_hash'),
    ('public', 'clients', 'deleted_at'),
    ('public', 'profiles', 'deleted_at'),
    ('public', 'reports', 'deleted_at'),
    ('public', 'reports', 'legal_hold_at'),
    ('public', 'shifts', 'deleted_at'),
    ('public', 'shifts', 'legal_hold_at'),
    ('public', 'shift_patterns', 'deleted_at'),
    ('public', 'user_session_activity', 'session_hash')
),
column_status AS (
  SELECT
    '06_required_column'::text AS section,
    format('%I.%I.%I', e.schema_name, e.table_name, e.column_name) AS object_name,
    CASE WHEN c.column_name IS NULL THEN 'FAIL' ELSE 'PASS' END AS result,
    jsonb_build_object('exists', c.column_name IS NOT NULL) AS details
  FROM expected_columns e
  LEFT JOIN information_schema.columns c
    ON c.table_schema = e.schema_name
   AND c.table_name = e.table_name
   AND c.column_name = e.column_name
),
critical_status AS (
  SELECT '07_critical_check'::text AS section, check_name AS object_name, result,
         '{}'::jsonb AS details
  FROM (
    SELECT
      'all public tables have RLS enabled' AS check_name,
      CASE WHEN bool_and(c.relrowsecurity) THEN 'PASS' ELSE 'FAIL' END AS result
    FROM pg_catalog.pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')

    UNION ALL SELECT 'anon cannot SELECT invitations',
      CASE WHEN NOT has_table_privilege('anon', 'public.invitations', 'SELECT') THEN 'PASS' ELSE 'FAIL' END
    UNION ALL SELECT 'authenticated cannot SELECT invitations directly',
      CASE WHEN NOT has_table_privilege('authenticated', 'public.invitations', 'SELECT') THEN 'PASS' ELSE 'FAIL' END
    UNION ALL SELECT 'operational tables have permissive SELECT base',
      CASE WHEN (
        SELECT count(*) FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND policyname = 'Authenticated read base'
          AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
      ) = 15 THEN 'PASS' ELSE 'FAIL' END
    UNION ALL SELECT 'operational tables require active session',
      CASE WHEN (
        SELECT count(*) FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND policyname = 'Require active server session'
          AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
      ) = 15 THEN 'PASS' ELSE 'FAIL' END
    UNION ALL SELECT 'authenticated cannot INSERT organization_members',
      CASE WHEN NOT has_table_privilege('authenticated', 'public.organization_members', 'INSERT') THEN 'PASS' ELSE 'FAIL' END
    UNION ALL SELECT 'authenticated cannot UPDATE reports directly',
      CASE WHEN NOT has_table_privilege('authenticated', 'public.reports', 'UPDATE') THEN 'PASS' ELSE 'FAIL' END
    UNION ALL SELECT 'authenticated cannot DELETE shifts directly',
      CASE WHEN NOT has_table_privilege('authenticated', 'public.shifts', 'DELETE') THEN 'PASS' ELSE 'FAIL' END
    UNION ALL SELECT 'authenticated can execute save_report_atomic',
      CASE WHEN to_regprocedure('public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text)') IS NOT NULL
        AND has_function_privilege(
          'authenticated',
          to_regprocedure('public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text)'),
          'EXECUTE'
        ) THEN 'PASS' ELSE 'FAIL' END
    UNION ALL SELECT 'anon cannot execute save_report_atomic',
      CASE WHEN to_regprocedure('public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text)') IS NOT NULL
        AND NOT has_function_privilege(
          'anon',
          to_regprocedure('public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text)'),
          'EXECUTE'
        ) THEN 'PASS' ELSE 'FAIL' END
  ) checks
),
definer_status AS (
  SELECT
    '08_security_definer'::text AS section,
    format('%I.%I(%s)', n.nspname, p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)) AS object_name,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) config
        WHERE config IN ('search_path=', 'search_path=""')
           OR config LIKE 'search_path=pg_catalog%'
      ) THEN 'WARN'
      WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'WARN'
      ELSE 'PASS'
    END AS result,
    jsonb_build_object(
      'config', pg_catalog.array_to_string(p.proconfig, ', '),
      'anon_can_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) AS details
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private')
    AND p.prosecdef
),
expected_triggers(trigger_name) AS (
  VALUES ('audit_events_chain_insert'), ('audit_events_no_update')
),
trigger_status AS (
  SELECT
    '09_audit_trigger'::text AS section,
    e.trigger_name::text AS object_name,
    CASE WHEN t.oid IS NULL THEN 'FAIL' WHEN t.tgenabled = 'D' THEN 'FAIL' ELSE 'PASS' END AS result,
    jsonb_build_object(
      'enabled_state', t.tgenabled,
      'definition', CASE WHEN t.oid IS NOT NULL THEN pg_catalog.pg_get_triggerdef(t.oid, true) END
    ) AS details
  FROM expected_triggers e
  LEFT JOIN pg_catalog.pg_trigger t
    ON t.tgrelid = to_regclass('public.audit_events')
   AND t.tgname = e.trigger_name
   AND NOT t.tgisinternal
)
SELECT section, object_name, result, details
FROM (
  SELECT
    '01_environment'::text AS section,
    current_database()::text AS object_name,
    'INFO'::text AS result,
    jsonb_build_object(
      'checked_at', now(),
      'executed_by', current_user,
      'postgres_version', current_setting('server_version')
    ) AS details

  UNION ALL SELECT
    '02_migrations',
    'supabase_migrations.schema_migrations',
    CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'INFO' ELSE 'PASS' END,
    jsonb_build_object('exists', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)

  UNION ALL SELECT * FROM rls_status
  UNION ALL SELECT * FROM policy_status
  UNION ALL SELECT * FROM grant_status
  UNION ALL SELECT * FROM column_status
  UNION ALL SELECT * FROM critical_status
  UNION ALL SELECT * FROM definer_status
  UNION ALL SELECT * FROM trigger_status
) report
ORDER BY section, object_name;

ROLLBACK;
