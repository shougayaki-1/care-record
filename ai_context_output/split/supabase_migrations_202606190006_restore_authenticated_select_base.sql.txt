-- RESTRICTIVEポリシーだけでは行を許可できないため、認証済みSELECTの許可基盤を明示する。
-- 実際の可視範囲は既存のRequire active server session / Tenant boundary等の
-- RESTRICTIVEポリシーがAND条件として制限する。

BEGIN;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations', 'organization_members', 'profiles', 'clients', 'staffs',
    'assignments', 'reports', 'report_values', 'report_images', 'form_templates',
    'shifts', 'shift_staffs', 'shift_patterns', 'shift_pattern_staffs', 'notifications'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Authenticated read base" ON public.%I', table_name);
      EXECUTE format(
        'CREATE POLICY "Authenticated read base" ON public.%I AS PERMISSIVE FOR SELECT TO authenticated USING (true)',
        table_name
      );
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', table_name);
    END IF;
  END LOOP;
END $$;

-- 招待一覧はServer Actionだけがservice_roleで取得する。ブラウザからはdefault denyを維持する。
REVOKE SELECT ON public.invitations FROM authenticated;

COMMIT;
