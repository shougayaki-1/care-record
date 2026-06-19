-- Supabase SQL Editor 用: DB / RLS / 権限の読み取り専用診断
-- 実行結果にはスキーマ情報のみを表示し、利用者・記録などの業務データは含めない。

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

-- 1. 実行環境
SELECT
  '01_environment' AS section,
  now() AS checked_at,
  current_database() AS database_name,
  current_user AS executed_by,
  current_setting('server_version') AS postgres_version;

-- 2. Supabase CLI のmigration履歴テーブル有無
-- SQL Editor中心で管理している環境では存在しないため、必須オブジェクトは後続項目で直接確認する。
SELECT
  '02_migrations' AS section,
  CASE
    WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
      THEN 'INFO: migration history table not present; inspect required objects below'
    ELSE 'PASS: migration history table exists'
  END AS result;

-- 3. public / storage の全テーブルにおけるRLS状態
SELECT
  '03_rls_status' AS section,
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  count(p.polname) AS policy_count,
  CASE
    WHEN NOT c.relrowsecurity THEN 'FAIL: RLS disabled'
    WHEN count(p.polname) = 0 THEN 'WARN: default deny (no policy)'
    ELSE 'PASS'
  END AS result
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
WHERE n.nspname IN ('public', 'storage')
  AND c.relkind IN ('r', 'p')
GROUP BY n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY n.nspname, c.relname;

-- 4. RLSポリシーの完全な定義
SELECT
  '04_rls_policies' AS section,
  schemaname AS schema_name,
  tablename AS table_name,
  policyname AS policy_name,
  permissive,
  roles,
  cmd,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_catalog.pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- 5. anon / authenticated / PUBLIC に明示されたテーブル権限
SELECT
  '05_table_grants' AS section,
  table_schema AS schema_name,
  table_name,
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.table_privileges
WHERE table_schema IN ('public', 'storage')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
GROUP BY table_schema, table_name, grantee
ORDER BY table_schema, table_name, grantee;

-- 6. security hardening が必要とする主要な列
WITH expected(schema_name, table_name, column_name) AS (
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
)
SELECT
  '06_required_columns' AS section,
  e.schema_name,
  e.table_name,
  e.column_name,
  CASE WHEN c.column_name IS NULL THEN 'FAIL: missing' ELSE 'PASS' END AS result
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = e.schema_name
 AND c.table_name = e.table_name
 AND c.column_name = e.column_name
ORDER BY e.schema_name, e.table_name, e.column_name;

-- 7. 重要なセキュリティ要件をPASS/FAILで確認
SELECT '07_critical_checks' AS section, check_name, result
FROM (
  SELECT
    'all public tables have RLS enabled' AS check_name,
    CASE WHEN bool_and(c.relrowsecurity) THEN 'PASS' ELSE 'FAIL' END AS result
  FROM pg_catalog.pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p')

  UNION ALL SELECT
    'anon cannot SELECT invitations',
    CASE WHEN NOT has_table_privilege('anon', 'public.invitations', 'SELECT') THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT
    'authenticated cannot SELECT invitations directly',
    CASE WHEN NOT has_table_privilege('authenticated', 'public.invitations', 'SELECT') THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT
    'operational tables have permissive SELECT base',
    CASE WHEN (
      SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND policyname = 'Authenticated read base'
        AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
    ) = 15 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT
    'operational tables require active session',
    CASE WHEN (
      SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND policyname = 'Require active server session'
        AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
    ) = 15 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT
    'authenticated cannot INSERT organization_members',
    CASE WHEN NOT has_table_privilege('authenticated', 'public.organization_members', 'INSERT') THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT
    'authenticated cannot UPDATE reports directly',
    CASE WHEN NOT has_table_privilege('authenticated', 'public.reports', 'UPDATE') THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT
    'authenticated cannot DELETE shifts directly',
    CASE WHEN NOT has_table_privilege('authenticated', 'public.shifts', 'DELETE') THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT
    'authenticated can execute save_report_atomic',
    CASE WHEN to_regprocedure('public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text)') IS NOT NULL
      AND has_function_privilege(
      'authenticated',
      to_regprocedure('public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text)'),
      'EXECUTE'
    ) THEN 'PASS' ELSE 'FAIL' END
  UNION ALL SELECT
    'anon cannot execute save_report_atomic',
    CASE WHEN to_regprocedure('public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text)') IS NOT NULL
      AND NOT has_function_privilege(
      'anon',
      to_regprocedure('public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text)'),
      'EXECUTE'
    ) THEN 'PASS' ELSE 'FAIL' END
) checks
ORDER BY check_name;

-- 8. SECURITY DEFINER関数と、その実行権限・固定search_path
SELECT
  '08_security_definer_functions' AS section,
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_catalog.array_to_string(p.proconfig, ', ') AS function_config,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) config
      WHERE config IN ('search_path=', 'search_path=""') OR config LIKE 'search_path=pg_catalog%'
    ) THEN 'WARN: review search_path'
    WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'WARN: anon executable'
    ELSE 'PASS/REVIEW'
  END AS result
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
  AND p.prosecdef
ORDER BY n.nspname, p.proname, arguments;

-- 9. 監査ログ保護トリガー
SELECT
  '09_audit_triggers' AS section,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
FROM pg_catalog.pg_trigger t
WHERE t.tgrelid = to_regclass('public.audit_events')
  AND NOT t.tgisinternal
ORDER BY t.tgname;

ROLLBACK;
