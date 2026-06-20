-- RLSを迂回するテーブル権限と、公開されたSECURITY DEFINER関数を是正する。
-- Supabase SQL Editorから再実行可能。業務データの変更・削除は行わない。

BEGIN;

-- public schemaを信頼済みオブジェクトだけに限定する。
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- このアプリに匿名DBアクセスは不要。RLSだけに依存せずテーブル権限も除去する。
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;

-- TRUNCATEとREFERENCESはRLSの対象外。TRIGGERもクライアントロールには不要。
-- storage schemaはSupabase管理対象なので変更せず、アプリ所有のpublicだけを対象にする。
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, authenticated;

-- postgresが今後作成するテーブルにも同じ最小権限を適用する。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, authenticated;

-- PostgreSQLの関数は既定でPUBLIC実行可能なので、今後の関数は明示許可方式にする。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- トリガーからだけ呼ばれる関数はクライアントから実行させない。
REVOKE ALL ON FUNCTION public.capture_report_version()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_report_values_version()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_audit_event_mutation()
  FROM PUBLIC, anon, authenticated;

-- 外部から呼ぶSECURITY DEFINER関数は匿名実行を禁止し、認証済みに限定する。
REVOKE ALL ON FUNCTION public.create_organization(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- legacy関数は未修飾名を含む可能性があるため、CREATEを剥奪した信頼済みschemaだけを探索する。
ALTER FUNCTION public.create_organization(text)
  SET search_path TO public, auth, extensions, pg_temp;
ALTER FUNCTION public.get_my_org_id()
  SET search_path TO public, auth, extensions, pg_temp;
ALTER FUNCTION public.handle_new_user()
  SET search_path TO public, auth, extensions, pg_temp;
ALTER FUNCTION public.is_org_admin(uuid)
  SET search_path TO public, auth, extensions, pg_temp;
ALTER FUNCTION public.is_org_member(uuid)
  SET search_path TO public, auth, extensions, pg_temp;
ALTER FUNCTION public.is_super_admin()
  SET search_path TO public, auth, extensions, pg_temp;
ALTER FUNCTION public.prevent_audit_event_mutation()
  SET search_path TO '';

COMMIT;

-- 実行後確認: 全行がPASSなら、このSQLが対象とする問題は解消済み。
WITH table_violations AS (
  SELECT count(*) AS count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) role_names(role_name)
  CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privileges(privilege_name)
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND has_table_privilege(role_names.role_name, c.oid, privileges.privilege_name)
),
anon_public_table_violations AS (
  SELECT count(*) AS count
  FROM pg_catalog.pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p')
    AND (
      has_table_privilege('anon', c.oid, 'SELECT')
      OR has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE')
      OR has_table_privilege('anon', c.oid, 'TRUNCATE')
      OR has_table_privilege('anon', c.oid, 'REFERENCES')
      OR has_table_privilege('anon', c.oid, 'TRIGGER')
    )
),
function_violations AS (
  SELECT count(*) AS count
  FROM (VALUES
    ('public.capture_report_version()'),
    ('public.capture_report_values_version()'),
    ('public.create_organization(text)'),
    ('public.get_my_org_id()'),
    ('public.handle_new_user()'),
    ('public.is_org_admin(uuid)'),
    ('public.is_org_member(uuid)'),
    ('public.is_super_admin()'),
    ('public.prevent_audit_event_mutation()')
  ) signatures(signature)
  WHERE has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
)
SELECT check_name, result, details
FROM (
  SELECT
    'RLS-bypassing table privileges removed' AS check_name,
    CASE WHEN count = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
    jsonb_build_object('violations', count) AS details
  FROM table_violations

  UNION ALL
  SELECT
    'anon has no public table privileges',
    CASE WHEN count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('violations', count)
  FROM anon_public_table_violations

  UNION ALL
  SELECT
    'anon cannot execute hardened SECURITY DEFINER functions',
    CASE WHEN count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('violations', count)
  FROM function_violations

  UNION ALL
  SELECT
    'untrusted roles cannot create objects in public schema',
    CASE
      WHEN NOT has_schema_privilege('anon', 'public', 'CREATE')
       AND NOT has_schema_privilege('authenticated', 'public', 'CREATE')
      THEN 'PASS' ELSE 'FAIL'
    END,
    jsonb_build_object(
      'anon_create', has_schema_privilege('anon', 'public', 'CREATE'),
      'authenticated_create', has_schema_privilege('authenticated', 'public', 'CREATE')
    )
) checks
ORDER BY check_name;
