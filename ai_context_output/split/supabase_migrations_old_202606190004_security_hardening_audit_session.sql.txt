-- 3省2ガイドライン準拠化: 原子更新、監査改ざん検知、セッション、nonce、保持ポリシー。
-- Supabase CLI で適用し、適用後は docs/compliance/production-evidence-checklist.md の証跡を保存すること。

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 監査証跡: 将来イベントを組織単位のハッシュチェーンにする。
-- 既存イベントは append-only 制約を維持するため legacy として扱い、起点ハッシュには含めない。
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS previous_hash text,
  ADD COLUMN IF NOT EXISTS event_hash text,
  ADD COLUMN IF NOT EXISTS integrity_version smallint NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS audit_events_event_id_key ON public.audit_events(event_id);
CREATE INDEX IF NOT EXISTS audit_events_session_idx ON public.audit_events(session_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.chain_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  chain_key text := COALESCE(NEW.organization_id::text, 'global');
  prior text;
  canonical text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || chain_key, 0));
  SELECT ae.event_hash INTO prior
    FROM public.audit_events ae
   WHERE ae.organization_id IS NOT DISTINCT FROM NEW.organization_id
     AND ae.event_hash IS NOT NULL
   ORDER BY ae.created_at DESC, ae.id DESC
   LIMIT 1;

  NEW.previous_hash := prior;
  canonical := concat_ws('|',
    NEW.event_id::text,
    COALESCE(NEW.organization_id::text, ''),
    COALESCE(NEW.actor_id::text, ''),
    NEW.action_type,
    NEW.resource_type,
    COALESCE(NEW.resource_id, ''),
    NEW.outcome,
    COALESCE(NEW.request_id, ''),
    COALESCE(NEW.session_id, ''),
    COALESCE(NEW.reason, ''),
    NEW.created_at::text,
    NEW.details::text,
    COALESCE(prior, 'GENESIS')
  );
  NEW.event_hash := encode(extensions.digest(convert_to(canonical, 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.chain_audit_event() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS audit_events_chain_insert ON public.audit_events;
CREATE TRIGGER audit_events_chain_insert
  BEFORE INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.chain_audit_event();

-- ---------------------------------------------------------------------------
-- 完全スナップショット: 記録本体と値を同一バージョンにまとめる。
-- ---------------------------------------------------------------------------
ALTER TABLE public.record_versions
  ADD COLUMN IF NOT EXISTS previous_hash text,
  ADD COLUMN IF NOT EXISTS snapshot_hash text,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id text;

CREATE OR REPLACE FUNCTION private.capture_complete_report_version(
  p_report_id uuid,
  p_actor_id uuid,
  p_change_reason text,
  p_session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_org_id uuid;
  next_version bigint;
  prior text;
  snap jsonb;
  snap_hash text;
  confirmer uuid;
BEGIN
  SELECT c.organization_id, r.approved_by,
         jsonb_build_object('report', to_jsonb(r), 'report_values', COALESCE(rv.data, '{}'::jsonb))
    INTO target_org_id, confirmer, snap
    FROM public.reports r
    JOIN public.clients c ON c.id = r.client_id
    LEFT JOIN public.report_values rv ON rv.report_id = r.id
   WHERE r.id = p_report_id;
  IF target_org_id IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('report-version:' || p_report_id::text, 0));
  SELECT rv.version_number, rv.snapshot_hash INTO next_version, prior
    FROM public.record_versions rv
   WHERE rv.resource_type = 'report' AND rv.resource_id = p_report_id
   ORDER BY rv.version_number DESC LIMIT 1;
  next_version := COALESCE(next_version, 0) + 1;
  snap_hash := encode(extensions.digest(convert_to(COALESCE(prior, 'GENESIS') || snap::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.record_versions(
    organization_id, resource_type, resource_id, version_number, snapshot,
    actor_id, confirmed_by, change_reason, session_id, previous_hash, snapshot_hash
  ) VALUES (
    target_org_id, 'report', p_report_id, next_version, snap,
    p_actor_id, confirmer, p_change_reason, p_session_id, prior, snap_hash
  );
  RETURN next_version;
END;
$$;
REVOKE ALL ON FUNCTION private.capture_complete_report_version(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

-- 既存トリガは部分スナップショットを作るため置換する。通常更新でも完全版を残し、
-- 原子RPC内では care_record.skip_version により最後の一回だけ保存する。
CREATE OR REPLACE FUNCTION public.capture_report_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('care_record.skip_version', true) = 'on' THEN RETURN NEW; END IF;
  PERFORM private.capture_complete_report_version(NEW.id, auth.uid(), 'report mutation', NULL);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_report_values_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('care_record.skip_version', true) = 'on' THEN RETURN NEW; END IF;
  PERFORM private.capture_complete_report_version(NEW.report_id, auth.uid(), 'report values mutation', NULL);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 原子的な記録保存RPC。認証、認可、記録、値、完全版、監査を1トランザクションで処理する。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_report_atomic(
  p_organization_id uuid,
  p_report_id uuid,
  p_client_id uuid,
  p_shift_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_status text,
  p_values jsonb,
  p_session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role text;
  target uuid := p_report_id;
  previous_status text;
  existing_helper uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_end_at <= p_start_at THEN RAISE EXCEPTION 'invalid_period'; END IF;
  IF p_status NOT IN ('draft', 'pending', 'approved', 'remanded') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF octet_length(p_values::text) > 1000000 THEN RAISE EXCEPTION 'values_too_large'; END IF;

  SELECT om.role INTO actor_role FROM public.organization_members om
   WHERE om.organization_id = p_organization_id AND om.user_id = actor;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'access_denied'; END IF;
  IF actor_role = 'staff' AND p_status IN ('approved', 'remanded') THEN RAISE EXCEPTION 'access_denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id AND c.organization_id = p_organization_id AND c.deleted_at IS NULL)
    THEN RAISE EXCEPTION 'client_not_found'; END IF;
  IF actor_role = 'staff' AND NOT EXISTS (
    SELECT 1 FROM public.assignments a WHERE a.client_id = p_client_id AND a.helper_id = actor
  ) THEN RAISE EXCEPTION 'access_denied'; END IF;
  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shifts s WHERE s.id = p_shift_id AND s.organization_id = p_organization_id
  ) THEN RAISE EXCEPTION 'shift_not_found'; END IF;

  PERFORM set_config('care_record.skip_version', 'on', true);
  IF target IS NULL THEN
    IF p_status IN ('approved', 'remanded') THEN RAISE EXCEPTION 'invalid_initial_status'; END IF;
    INSERT INTO public.reports(client_id, helper_id, start_at, end_at, status, shift_id, updated_at)
    VALUES (p_client_id, actor, p_start_at, p_end_at, p_status, p_shift_id, now()) RETURNING id INTO target;
    INSERT INTO public.report_values(report_id, data) VALUES(target, p_values);
  ELSE
    SELECT r.status, r.helper_id INTO previous_status, existing_helper
      FROM public.reports r JOIN public.clients c ON c.id = r.client_id
     WHERE r.id = target AND r.client_id = p_client_id AND c.organization_id = p_organization_id
       AND r.deleted_at IS NULL FOR UPDATE;
    IF previous_status IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;
    IF actor_role = 'staff' AND existing_helper IS DISTINCT FROM actor THEN RAISE EXCEPTION 'access_denied'; END IF;
    IF previous_status = 'approved' AND p_status <> 'remanded' THEN RAISE EXCEPTION 'approved_report_locked'; END IF;

    UPDATE public.reports SET start_at=p_start_at, end_at=p_end_at, status=p_status,
      shift_id=p_shift_id, updated_at=now(),
      approved_by=CASE WHEN p_status='approved' THEN actor WHEN p_status='remanded' THEN NULL ELSE approved_by END,
      approved_at=CASE WHEN p_status='approved' THEN now() WHEN p_status='remanded' THEN NULL ELSE approved_at END
     WHERE id=target;
    IF EXISTS (SELECT 1 FROM public.report_values rv WHERE rv.report_id=target) THEN
      UPDATE public.report_values SET data=p_values WHERE report_id=target;
    ELSE
      INSERT INTO public.report_values(report_id,data) VALUES(target,p_values);
    END IF;
  END IF;

  PERFORM private.capture_complete_report_version(target, actor, CASE WHEN p_report_id IS NULL THEN 'create' ELSE 'update:'||p_status END, p_session_id);
  INSERT INTO public.audit_events(organization_id,actor_id,action_type,resource_type,resource_id,outcome,session_id,details)
  VALUES(p_organization_id,actor,CASE WHEN p_report_id IS NULL THEN 'report.create' ELSE 'report.'||p_status END,
    'report',target::text,'success',p_session_id,jsonb_build_object('previousStatus',previous_status,'newStatus',p_status));
  RETURN target;
END;
$$;
REVOKE ALL ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- サーバー管理セッション。アクセストークン自体は保存せずSHA-256のみ保持する。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_session_activity (
  session_hash text PRIMARY KEY,
  auth_session_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_activity timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS user_session_activity_user_idx ON public.user_session_activity(user_id,last_activity DESC);
CREATE UNIQUE INDEX IF NOT EXISTS user_session_activity_auth_session_key ON public.user_session_activity(auth_session_id);
ALTER TABLE public.user_session_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_session_activity FROM anon, authenticated;
CREATE POLICY "Users can verify own session activity" ON public.user_session_activity
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id AND auth_session_id = (SELECT auth.jwt()->>'session_id'));
GRANT SELECT ON public.user_session_activity TO authenticated;

CREATE OR REPLACE FUNCTION private.is_session_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_session_activity usa
     WHERE usa.user_id=auth.uid() AND usa.auth_session_id=(auth.jwt()->>'session_id')
       AND usa.revoked_at IS NULL AND usa.last_activity >= now()-interval '16 minutes'
       AND usa.absolute_expires_at > now()
  );
$$;
REVOKE ALL ON FUNCTION private.is_session_active() FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_session_active() TO authenticated;
