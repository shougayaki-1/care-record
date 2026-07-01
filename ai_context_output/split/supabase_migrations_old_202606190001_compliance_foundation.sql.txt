-- 3省2ガイドライン対応の基盤: 保持、論理削除、版履歴、追記専用監査ログ
-- アプリケーション更新と同時に適用すること。

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS retention_years smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_retention_years_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_retention_years_check
      CHECK (retention_years BETWEEN 1 AND 30);
  END IF;
END $$;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;

ALTER TABLE public.staffs
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffs ENABLE ROW LEVEL SECURITY;

-- 記録系の変更は認証・監査付きServer Actionに限定する。
REVOKE INSERT, UPDATE, DELETE ON public.reports FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.report_values FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.report_images FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.clients FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.form_templates FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.assignments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.staffs FROM authenticated;
REVOKE UPDATE, DELETE ON public.organizations FROM authenticated;
REVOKE UPDATE, DELETE ON public.profiles FROM authenticated;
REVOKE UPDATE, DELETE ON public.notifications FROM authenticated;

-- 画像は公開URLではなく、短時間の署名URLでのみ配信する。
UPDATE storage.buckets SET public = false WHERE id = 'report-images';

DROP POLICY IF EXISTS "Deny direct report image changes" ON storage.objects;
CREATE POLICY "Deny direct report image changes"
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'report-images');

DROP POLICY IF EXISTS "Deny direct report image updates" ON storage.objects;
CREATE POLICY "Deny direct report image updates"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'report-images')
  WITH CHECK (bucket_id <> 'report-images');

DROP POLICY IF EXISTS "Deny direct report image deletes" ON storage.objects;
CREATE POLICY "Deny direct report image deletes"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'report-images');

CREATE INDEX IF NOT EXISTS reports_active_idx
  ON public.reports (client_id, start_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clients_active_idx
  ON public.clients (organization_id, name)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS staffs_active_idx
  ON public.staffs (organization_id, sort_order, name)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
  request_id text,
  ip_hash text,
  user_agent text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_org_created_idx
  ON public.audit_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_resource_idx
  ON public.audit_events (resource_type, resource_id, created_at DESC);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_no_update ON public.audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();

CREATE TABLE IF NOT EXISTS public.record_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  version_number bigint NOT NULL,
  snapshot jsonb NOT NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_id, version_number)
);

ALTER TABLE public.record_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.record_versions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_report_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_org_id uuid;
  next_version bigint;
BEGIN
  SELECT c.organization_id INTO target_org_id
    FROM public.clients c
   WHERE c.id = NEW.client_id;

  IF target_org_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve report organization';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text, 0));
  SELECT COALESCE(MAX(rv.version_number), 0) + 1 INTO next_version
    FROM public.record_versions rv
   WHERE rv.resource_type = 'report' AND rv.resource_id = NEW.id;

  INSERT INTO public.record_versions (
    organization_id, resource_type, resource_id, version_number, snapshot, actor_id
  ) VALUES (
    target_org_id, 'report', NEW.id, next_version, to_jsonb(NEW), auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_capture_version ON public.reports;
CREATE TRIGGER reports_capture_version
  AFTER INSERT OR UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.capture_report_version();

CREATE OR REPLACE FUNCTION public.capture_report_values_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_org_id uuid;
  next_version bigint;
BEGIN
  SELECT c.organization_id INTO target_org_id
    FROM public.reports r
    JOIN public.clients c ON c.id = r.client_id
   WHERE r.id = NEW.report_id;

  IF target_org_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve report values organization';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.report_id::text, 0));
  SELECT COALESCE(MAX(rv.version_number), 0) + 1 INTO next_version
    FROM public.record_versions rv
   WHERE rv.resource_type = 'report' AND rv.resource_id = NEW.report_id;

  INSERT INTO public.record_versions (
    organization_id, resource_type, resource_id, version_number, snapshot, actor_id
  ) VALUES (
    target_org_id,
    'report',
    NEW.report_id,
    next_version,
    jsonb_build_object('report_values', to_jsonb(NEW)),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_values_capture_version ON public.report_values;
CREATE TRIGGER report_values_capture_version
  AFTER INSERT OR UPDATE ON public.report_values
  FOR EACH ROW EXECUTE FUNCTION public.capture_report_values_version();

-- 既存記録も初版として保存する。再実行時は重複させない。
INSERT INTO public.record_versions (
  organization_id, resource_type, resource_id, version_number, snapshot, change_reason
)
SELECT
  c.organization_id,
  'report',
  r.id,
  1,
  jsonb_build_object('report', to_jsonb(r), 'report_values', to_jsonb(rv)),
  'migration backfill'
FROM public.reports r
JOIN public.clients c ON c.id = r.client_id
LEFT JOIN public.report_values rv ON rv.report_id = r.id
ON CONFLICT (resource_type, resource_id, version_number) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'completed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deletion_requests FROM anon, authenticated;

-- 旧監査テーブルが存在する環境では、新しい追記専用テーブルへ一度だけ移行する。
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    EXECUTE $migration$
      INSERT INTO public.audit_events (
        organization_id, actor_id, action_type, resource_type, resource_id, details, created_at
      )
      SELECT
        organization_id,
        actor_id,
        action_type,
        'legacy',
        target_resource::text,
        COALESCE(details, '{}'::jsonb),
        created_at
      FROM public.audit_logs old_log
      WHERE NOT EXISTS (
        SELECT 1 FROM public.audit_events new_log
        WHERE new_log.organization_id = old_log.organization_id
          AND new_log.action_type = old_log.action_type
          AND new_log.created_at = old_log.created_at
      )
    $migration$;
  END IF;
END $$;

-- 論理削除済み記録はowner/manager以外の直接SELECTから隠す。
DROP POLICY IF EXISTS "Restrict deleted report visibility" ON public.reports;
CREATE POLICY "Restrict deleted report visibility"
  ON public.reports AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL OR EXISTS (
      SELECT 1
        FROM public.clients c
        JOIN public.organization_members om ON om.organization_id = c.organization_id
       WHERE c.id = reports.client_id
         AND om.user_id = auth.uid()
         AND om.role IN ('owner', 'manager')
    )
  );

-- 削除済みの利用者・スタッフは通常のAPIから完全に隠し、保持期間中はservice roleだけが保全する。
DROP POLICY IF EXISTS "Hide deleted clients" ON public.clients;
CREATE POLICY "Hide deleted clients"
  ON public.clients AS RESTRICTIVE FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "Hide deleted staffs" ON public.staffs;
CREATE POLICY "Hide deleted staffs"
  ON public.staffs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (deleted_at IS NULL);
