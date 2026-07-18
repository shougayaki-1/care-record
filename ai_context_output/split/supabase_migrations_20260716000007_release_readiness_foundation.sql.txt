-- Release-readiness security foundation.

CREATE TABLE IF NOT EXISTS public.reauth_grants (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_session_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN (
    'owner_transfer',
    'organization_delete',
    'external_secret_change',
    'backup_restore'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);

ALTER TABLE public.reauth_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reauth_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reauth_grants TO service_role;

CREATE INDEX IF NOT EXISTS reauth_grants_expiry_idx
  ON public.reauth_grants (expires_at)
  WHERE used_at IS NULL;

-- Existing roles are backward compatible; the application normalizes a missing key to false.
-- Owners receive this permission independently through FULL_PERMISSIONS.
UPDATE public.organization_roles
SET permissions = jsonb_set(
  permissions,
  '{management,backupStatus}',
  CASE
    WHEN is_preset AND lower(name) IN ('manager', '管理者') THEN 'true'::jsonb
    ELSE COALESCE(permissions #> '{management,backupStatus}', 'false'::jsonb)
  END,
  true
)
WHERE NOT COALESCE((permissions #> '{management}') ? 'backupStatus', false);

-- Accepted risks remain explicit and require an approver before status can become accepted.
INSERT INTO public.compliance_risks
  (risk_key, description, likelihood, impact, treatment, status)
VALUES
  ('mfa-not-enabled', 'MFA未導入', 3, 4, '招待制、試行制限、重要操作再認証、セッション失効', 'mitigating'),
  ('password-minimum-eight', 'パスワード8文字・漏えい照合なし', 3, 3, 'パスワードマネージャー許可、試行制限、列挙防止', 'mitigating'),
  ('long-session', '無操作24時間・絶対30日セッション', 3, 4, '重要操作再認証、他端末失効、共用端末保持禁止', 'mitigating'),
  ('supabase-free', 'Supabase Free利用', 3, 4, '容量安全弁、外形監視、独自バックアップ、段階提供', 'mitigating'),
  ('infrastructure-access-audit', '基盤アクセスと監査の非強制連動', 2, 5, 'アプリ内閲覧機能なし、GCSへのアクセス前後記録', 'mitigating'),
  ('malware-scan-not-enabled', 'マルウェア検査未導入', 2, 4, '形式限定、シグネチャ照合、再エンコード、元ファイル非保存', 'mitigating')
ON CONFLICT (risk_key) DO UPDATE SET
  description = EXCLUDED.description,
  treatment = EXCLUDED.treatment,
  reviewed_at = now();

ALTER TABLE public.compliance_risks
  DROP CONSTRAINT IF EXISTS compliance_risks_accepted_requires_approver;
ALTER TABLE public.compliance_risks
  ADD CONSTRAINT compliance_risks_accepted_requires_approver
  CHECK (status <> 'accepted' OR approved_by IS NOT NULL);

-- Database capacity guard. These functions only inspect PostgreSQL metadata and
-- never read tenant data. Thresholds use MiB to match PostgreSQL size reporting.
CREATE OR REPLACE FUNCTION private.database_capacity_status(p_size_bytes bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  size_bytes bigint := COALESCE(p_size_bytes, pg_database_size(current_database()));
  mib bigint := 1024 * 1024;
  level text;
BEGIN
  IF size_bytes < 0 THEN RAISE EXCEPTION 'invalid_database_size'; END IF;
  level := CASE
    WHEN size_bytes >= 450 * mib THEN 'critical'
    WHEN size_bytes >= 400 * mib THEN 'restricted'
    WHEN size_bytes >= 300 * mib THEN 'warning'
    ELSE 'normal'
  END;
  RETURN jsonb_build_object(
    'level', level,
    'sizeBytes', size_bytes,
    'sizeMb', round(size_bytes::numeric / mib, 1),
    'allowNewOrganizations', size_bytes < 400 * mib,
    'allowBulkImports', size_bytes < 400 * mib,
    'allowNewReports', size_bytes < 450 * mib
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_database_capacity(
  p_operation text,
  p_size_bytes bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  capacity jsonb := private.database_capacity_status(p_size_bytes);
BEGIN
  IF p_operation IN ('new_organization', 'bulk_import')
     AND NOT (capacity->>'allowNewOrganizations')::boolean THEN
    RAISE EXCEPTION 'database_capacity_blocks_%', p_operation;
  END IF;
  IF p_operation = 'new_report'
     AND NOT (capacity->>'allowNewReports')::boolean THEN
    RAISE EXCEPTION 'database_capacity_blocks_new_report';
  END IF;
  IF p_operation NOT IN ('new_organization', 'bulk_import', 'new_report') THEN
    RAISE EXCEPTION 'invalid_capacity_operation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_database_capacity_status()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$ SELECT private.database_capacity_status(); $$;

REVOKE ALL ON FUNCTION private.database_capacity_status(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.enforce_database_capacity(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_database_capacity_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_database_capacity_status() TO service_role;

-- Optimistic locking and idempotency for report mutations (expand phase).
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS current_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_revision_id uuid REFERENCES public.record_versions(id) ON DELETE RESTRICT;

WITH latest AS (
  SELECT DISTINCT ON (resource_id) resource_id, id, version_number
  FROM public.record_versions
  WHERE resource_type = 'report'
  ORDER BY resource_id, version_number DESC
)
UPDATE public.reports r
SET current_version = latest.version_number,
    current_revision_id = latest.id
FROM latest
WHERE latest.resource_id = r.id
  AND (r.current_version = 0 OR r.current_revision_id IS NULL);

CREATE TABLE IF NOT EXISTS public.report_mutation_keys (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('save', 'approve')),
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_id, idempotency_key, operation)
);

ALTER TABLE public.report_mutation_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.report_mutation_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.report_mutation_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.report_corrections (
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE RESTRICT,
  prior_revision_id uuid NOT NULL REFERENCES public.record_versions(id) ON DELETE RESTRICT,
  corrected_revision_id uuid NOT NULL REFERENCES public.record_versions(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  corrected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, corrected_revision_id)
);

ALTER TABLE public.report_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read accessible report corrections" ON public.report_corrections
  FOR SELECT TO authenticated
  USING (private.can_access_report(report_id));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.report_corrections FROM anon, authenticated;
GRANT SELECT ON TABLE public.report_corrections TO authenticated;
GRANT ALL ON TABLE public.report_corrections TO service_role;

CREATE OR REPLACE FUNCTION public.save_report_versioned(
  p_organization_id uuid,
  p_report_id uuid,
  p_client_id uuid,
  p_shift_id uuid,
  p_segment_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_status text,
  p_values jsonb,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_session_id text DEFAULT NULL,
  p_actual_service_type_id uuid DEFAULT NULL,
  p_actual_staffs jsonb DEFAULT '[]'::jsonb,
  p_correction_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  target uuid := p_report_id;
  current_version bigint := 0;
  prior_revision uuid;
  latest_revision uuid;
  latest_version bigint;
  payload_hash text;
  existing_key public.report_mutation_keys%ROWTYPE;
  response jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'version_and_idempotency_required';
  END IF;
  IF target IS NULL THEN
    PERFORM private.enforce_database_capacity('new_report');
  END IF;

  payload_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'report_id', p_report_id, 'client_id', p_client_id, 'shift_id', p_shift_id,
    'segment_id', p_segment_id, 'start_at', p_start_at, 'end_at', p_end_at,
    'status', p_status, 'values', p_values, 'actual_service_type_id', p_actual_service_type_id,
    'actual_staffs', p_actual_staffs, 'correction_reason', p_correction_reason
  )::text, 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO existing_key
  FROM public.report_mutation_keys
  WHERE organization_id = p_organization_id AND actor_id = actor
    AND idempotency_key = p_idempotency_key AND operation = 'save';
  IF FOUND THEN
    IF existing_key.request_hash <> payload_hash THEN RAISE EXCEPTION 'idempotency_key_reused'; END IF;
    RETURN existing_key.result || jsonb_build_object('replayed', true);
  END IF;

  IF target IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('report-save:' || target::text, 0));
    SELECT r.current_version, r.current_revision_id INTO current_version, prior_revision
    FROM public.reports r WHERE r.id = target FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found'; END IF;
  END IF;
  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE = 'CR409', MESSAGE = jsonb_build_object(
      'code', 'REPORT_VERSION_CONFLICT', 'expectedVersion', p_expected_version,
      'currentVersion', current_version, 'currentRevisionId', prior_revision
    )::text;
  END IF;

  IF prior_revision IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.reports r WHERE r.id = target AND r.status = 'approved'
  ) AND NULLIF(btrim(p_correction_reason), '') IS NULL THEN
    RAISE EXCEPTION 'correction_reason_required';
  END IF;

  target := public.save_report_atomic_v2(
    p_organization_id, p_report_id, p_client_id, p_shift_id, p_segment_id,
    p_start_at, p_end_at, p_status, p_values, p_session_id,
    p_actual_service_type_id, p_actual_staffs
  );

  SELECT rv.id, rv.version_number INTO latest_revision, latest_version
  FROM public.record_versions rv
  WHERE rv.resource_type = 'report' AND rv.resource_id = target
  ORDER BY rv.version_number DESC LIMIT 1;
  IF latest_revision IS NULL THEN RAISE EXCEPTION 'report_revision_missing'; END IF;

  UPDATE public.reports
  SET current_version = latest_version, current_revision_id = latest_revision
  WHERE id = target;

  IF prior_revision IS NOT NULL AND NULLIF(btrim(p_correction_reason), '') IS NOT NULL THEN
    INSERT INTO public.report_corrections(
      report_id, prior_revision_id, corrected_revision_id, reason, corrected_by
    ) VALUES (target, prior_revision, latest_revision, btrim(p_correction_reason), actor);
  END IF;

  response := jsonb_build_object(
    'recordId', target, 'revisionId', latest_revision,
    'version', latest_version, 'replayed', false
  );
  INSERT INTO public.report_mutation_keys(
    organization_id, actor_id, idempotency_key, operation, request_hash, result
  ) VALUES (p_organization_id, actor, p_idempotency_key, 'save', payload_hash, response);
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION public.save_report_versioned(
  uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, jsonb,
  bigint, uuid, text, uuid, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_versioned(
  uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, jsonb,
  bigint, uuid, text, uuid, jsonb, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_record_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'record_versions_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS record_versions_no_update_delete ON public.record_versions;
CREATE TRIGGER record_versions_no_update_delete
  BEFORE UPDATE OR DELETE ON public.record_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_record_version_mutation();

REVOKE ALL ON FUNCTION public.prevent_record_version_mutation() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.report_image_upload_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  canceled_at timestamptz
);
ALTER TABLE public.report_image_upload_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.report_image_upload_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.report_image_upload_events TO service_role;
CREATE INDEX IF NOT EXISTS report_image_upload_events_rate_idx
  ON public.report_image_upload_events (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reserve_report_image_upload(p_report_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  reservation uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.can_access_report(p_report_id) THEN RAISE EXCEPTION 'access_denied'; END IF;
  IF EXISTS (SELECT 1 FROM public.reports WHERE id = p_report_id AND status = 'approved') THEN
    RAISE EXCEPTION 'approved_report_locked';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('report-image:' || p_report_id::text, 0));
  IF ((SELECT count(*) FROM public.report_images WHERE report_id = p_report_id)
      + (SELECT count(*) FROM public.report_image_upload_events
         WHERE report_id = p_report_id
           AND completed_at IS NULL AND canceled_at IS NULL
           AND created_at >= now() - interval '10 minutes')) >= 20 THEN
    RAISE EXCEPTION 'report_image_limit_exceeded';
  END IF;
  IF (SELECT count(*) FROM public.report_image_upload_events
      WHERE user_id = actor AND created_at >= now() - interval '1 minute') >= 10 THEN
    RAISE EXCEPTION 'report_image_rate_limited';
  END IF;
  INSERT INTO public.report_image_upload_events(report_id, user_id)
  VALUES (p_report_id, actor)
  RETURNING reservation_id INTO reservation;
  RETURN reservation;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_report_image_upload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_report_image_upload(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.finish_report_image_upload(p_reservation_id uuid, p_completed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  UPDATE public.report_image_upload_events
  SET completed_at = CASE WHEN p_completed THEN now() ELSE completed_at END,
      canceled_at = CASE WHEN p_completed THEN canceled_at ELSE now() END
  WHERE reservation_id = p_reservation_id
    AND user_id = actor
    AND completed_at IS NULL
    AND canceled_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_upload_reservation'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_report_image_upload(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_report_image_upload(uuid, boolean) TO authenticated;

-- Settings writes use authenticated RLS; organization_id is deliberately not updatable.
GRANT INSERT ON public.service_types, public.staff_roles, public.labor_premium_types TO authenticated;
GRANT UPDATE (name, is_active, sort_order, deleted_at) ON public.service_types TO authenticated;
GRANT UPDATE (name, is_unpaid, is_active, sort_order, deleted_at) ON public.staff_roles TO authenticated;
GRANT UPDATE (
  name, rate, calc_method, is_enabled, night_start_hour, night_end_hour,
  overtime_daily_threshold_hours, overtime_weekly_threshold_hours, updated_at,
  variable_working_hours_enabled, variable_overtime_period, variable_overtime_threshold_hours
) ON public.labor_premium_types TO authenticated;

CREATE POLICY "Manage service types" ON public.service_types
  FOR UPDATE TO authenticated
  USING (private.has_management_permission(organization_id, auth.uid(), 'organization'))
  WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'organization'));
CREATE POLICY "Manage staff roles" ON public.staff_roles
  FOR UPDATE TO authenticated
  USING (private.has_management_permission(organization_id, auth.uid(), 'organization'))
  WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'organization'));
CREATE POLICY "Manage labor premium types" ON public.labor_premium_types
  FOR UPDATE TO authenticated
  USING (private.has_management_permission(organization_id, auth.uid(), 'organization'))
  WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'organization'));

CREATE OR REPLACE FUNCTION public.create_service_type_atomic(p_organization_id uuid, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_management_permission(p_organization_id, auth.uid(), 'organization') THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('service-types:' || p_organization_id::text, 0));
  INSERT INTO public.service_types(organization_id, name, sort_order)
  SELECT p_organization_id, btrim(p_name), COALESCE(max(sort_order), -1) + 1
  FROM public.service_types WHERE organization_id = p_organization_id AND deleted_at IS NULL
  RETURNING id INTO result;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.create_staff_role_atomic(p_organization_id uuid, p_name text, p_is_unpaid boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_management_permission(p_organization_id, auth.uid(), 'organization') THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-roles:' || p_organization_id::text, 0));
  INSERT INTO public.staff_roles(organization_id, name, is_unpaid, sort_order)
  SELECT p_organization_id, btrim(p_name), COALESCE(p_is_unpaid, false), COALESCE(max(sort_order), -1) + 1
  FROM public.staff_roles WHERE organization_id = p_organization_id AND deleted_at IS NULL
  RETURNING id INTO result;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.create_labor_premium_type_atomic(
  p_organization_id uuid, p_name text, p_rate numeric, p_calc_method text,
  p_night_start_hour smallint, p_night_end_hour smallint,
  p_variable_working_hours_enabled boolean DEFAULT false,
  p_variable_overtime_period text DEFAULT NULL,
  p_variable_overtime_threshold_hours numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_management_permission(p_organization_id, auth.uid(), 'organization') THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR p_rate < 0 OR p_rate > 10
     OR p_calc_method NOT IN ('additive', 'multiplicative') THEN RAISE EXCEPTION 'invalid_premium'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('labor-premiums:' || p_organization_id::text, 0));
  INSERT INTO public.labor_premium_types(
    organization_id, name, rate, calc_method, builtin_type, night_start_hour,
    night_end_hour, display_order, variable_working_hours_enabled,
    variable_overtime_period, variable_overtime_threshold_hours
  ) SELECT p_organization_id, btrim(p_name), p_rate, p_calc_method, 'custom',
    p_night_start_hour, p_night_end_hour, COALESCE(max(display_order), 0) + 1,
    COALESCE(p_variable_working_hours_enabled, false), p_variable_overtime_period,
    p_variable_overtime_threshold_hours
  FROM public.labor_premium_types WHERE organization_id = p_organization_id
  RETURNING id INTO result;
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.create_service_type_atomic(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_staff_role_atomic(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_labor_premium_type_atomic(uuid, text, numeric, text, smallint, smallint, boolean, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_service_type_atomic(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff_role_atomic(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_labor_premium_type_atomic(uuid, text, numeric, text, smallint, smallint, boolean, text, numeric) TO authenticated;

-- New organizations are blocked before any tenant data is written once the
-- database reaches the 400 MiB safety threshold.
CREATE OR REPLACE FUNCTION public.create_organization(org_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  new_org_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF length(btrim(org_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  PERFORM private.enforce_database_capacity('new_organization');
  INSERT INTO public.organizations(name) VALUES (btrim(org_name)) RETURNING id INTO new_org_id;
  INSERT INTO public.organization_members(organization_id, user_id, role)
  VALUES (new_org_id, actor, 'owner');
  RETURN new_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated, service_role;
