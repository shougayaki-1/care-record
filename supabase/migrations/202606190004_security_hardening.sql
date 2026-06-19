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

-- ブラウザから残る既存SELECTにもサーバー管理セッション期限を強制する。
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','organization_members','profiles','clients','staffs','assignments',
    'reports','report_values','report_images','form_templates','shifts','shift_staffs','shift_patterns',
    'shift_pattern_staffs','notifications'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Require active server session" ON public.%I',t);
      EXECUTE format('CREATE POLICY "Require active server session" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING ((SELECT private.is_session_active()))',t);
    END IF;
  END LOOP;
END $$;

-- 以下のアクセス判定関数とRLSポリシーが論理削除列を参照するため、先に追加する。
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.shift_patterns
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 既存のpermissive policyに依存せず、テナント境界をRESTRICTIVE policyで固定する。
CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id uuid, p_roles text[] DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.organization_members om
    WHERE om.organization_id=p_org_id AND om.user_id=auth.uid()
      AND (p_roles IS NULL OR om.role=ANY(p_roles)));
$$;
CREATE OR REPLACE FUNCTION private.can_access_client(p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.clients c JOIN public.organization_members om ON om.organization_id=c.organization_id
    WHERE c.id=p_client_id AND c.deleted_at IS NULL AND om.user_id=auth.uid()
      AND (om.role IN('owner','manager') OR EXISTS(SELECT 1 FROM public.assignments a WHERE a.client_id=c.id AND a.helper_id=auth.uid())));
$$;
CREATE OR REPLACE FUNCTION private.can_access_report(p_report_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.reports r WHERE r.id=p_report_id AND r.deleted_at IS NULL
    AND private.can_access_client(r.client_id));
$$;
CREATE OR REPLACE FUNCTION private.can_access_shift(p_shift_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.shifts s WHERE s.id=p_shift_id AND s.deleted_at IS NULL
    AND private.is_org_member(s.organization_id));
$$;
REVOKE ALL ON FUNCTION private.is_org_member(uuid,text[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.can_access_client(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.can_access_report(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.can_access_shift(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.is_org_member(uuid,text[]), private.can_access_client(uuid), private.can_access_report(uuid), private.can_access_shift(uuid) TO authenticated;

DROP POLICY IF EXISTS "Tenant boundary organizations" ON public.organizations;
CREATE POLICY "Tenant boundary organizations" ON public.organizations AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.is_org_member(id)));
DROP POLICY IF EXISTS "Tenant boundary members" ON public.organization_members;
CREATE POLICY "Tenant boundary members" ON public.organization_members AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.is_org_member(organization_id)));
DROP POLICY IF EXISTS "Tenant boundary clients" ON public.clients;
CREATE POLICY "Tenant boundary clients" ON public.clients AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_client(id)));
DROP POLICY IF EXISTS "Tenant boundary staffs" ON public.staffs;
CREATE POLICY "Tenant boundary staffs" ON public.staffs AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.is_org_member(organization_id)) AND deleted_at IS NULL);
DROP POLICY IF EXISTS "Tenant boundary reports" ON public.reports;
CREATE POLICY "Tenant boundary reports" ON public.reports AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_report(id)));
DROP POLICY IF EXISTS "Tenant boundary report values" ON public.report_values;
CREATE POLICY "Tenant boundary report values" ON public.report_values AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_report(report_id)));
DROP POLICY IF EXISTS "Tenant boundary report images" ON public.report_images;
CREATE POLICY "Tenant boundary report images" ON public.report_images AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_report(report_id)));
DROP POLICY IF EXISTS "Tenant boundary form templates" ON public.form_templates;
CREATE POLICY "Tenant boundary form templates" ON public.form_templates AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_client(client_id)));
DROP POLICY IF EXISTS "Tenant boundary shifts" ON public.shifts;
CREATE POLICY "Tenant boundary shifts" ON public.shifts AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.is_org_member(organization_id)) AND deleted_at IS NULL);
DROP POLICY IF EXISTS "Tenant boundary shift staffs" ON public.shift_staffs;
CREATE POLICY "Tenant boundary shift staffs" ON public.shift_staffs AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_shift(shift_id)));
DROP POLICY IF EXISTS "Tenant boundary shift patterns" ON public.shift_patterns;
CREATE POLICY "Tenant boundary shift patterns" ON public.shift_patterns AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.is_org_member(organization_id)) AND deleted_at IS NULL);
DROP POLICY IF EXISTS "Tenant boundary shift pattern staffs" ON public.shift_pattern_staffs;
CREATE POLICY "Tenant boundary shift pattern staffs" ON public.shift_pattern_staffs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.shift_patterns sp WHERE sp.id=shift_pattern_staffs.pattern_id
    AND sp.deleted_at IS NULL AND private.is_org_member(sp.organization_id)));
DROP POLICY IF EXISTS "Tenant boundary assignments" ON public.assignments;
CREATE POLICY "Tenant boundary assignments" ON public.assignments AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT private.can_access_client(client_id)));
DROP POLICY IF EXISTS "Own notifications only" ON public.notifications;
CREATE POLICY "Own notifications only" ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id=auth.uid());
DROP POLICY IF EXISTS "Profile directory boundary" ON public.profiles;
CREATE POLICY "Profile directory boundary" ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id=auth.uid() OR EXISTS(
    SELECT 1 FROM public.organization_members mine JOIN public.organization_members theirs ON theirs.organization_id=mine.organization_id
     WHERE mine.user_id=auth.uid() AND theirs.user_id=profiles.id));

-- 外部OAuthのstateはCookieだけでなくサーバー側でも一度だけ消費する。
CREATE TABLE IF NOT EXISTS public.oauth_nonces (
  nonce_hash text PRIMARY KEY,
  provider text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oauth_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oauth_nonces FROM anon, authenticated;

ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_reason text;
CREATE TABLE IF NOT EXISTS public.user_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'requested'
    CHECK(status IN('requested','approved','rejected','completed')),
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, decided_at timestamptz,
  retention_basis text NOT NULL, completed_at timestamptz
);
ALTER TABLE public.user_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_deletion_requests FROM anon,authenticated;
UPDATE public.invitations SET expires_at = COALESCE(expires_at, now() + interval '7 days') WHERE is_used = false;

-- 記録種別別の保持とリーガルホールド。
CREATE TABLE IF NOT EXISTS public.retention_policies (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  retention_years smallint NOT NULL CHECK(retention_years BETWEEN 1 AND 30),
  legal_basis text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY(organization_id,resource_type)
);
ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retention_policies FROM anon, authenticated;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS legal_hold_at timestamptz;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS legal_hold_reason text;
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS legal_hold_at timestamptz;
ALTER TABLE public.shift_patterns
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;
INSERT INTO public.retention_policies(organization_id,resource_type,retention_years,legal_basis)
SELECT o.id, resource_type, o.retention_years,
       '移行時暫定値。専門家確認と組織承認が完了するまで本番適合証跡として使用不可'
  FROM public.organizations o
 CROSS JOIN (VALUES('report'),('client'),('staff'),('shift'),('organization')) AS resources(resource_type)
ON CONFLICT(organization_id,resource_type) DO NOTHING;

-- default denyの実効性を上げる。既知の危険ポリシーを正式migrationで除去。
DROP POLICY IF EXISTS "Insert members" ON public.organization_members;
DROP POLICY IF EXISTS "Read invitations" ON public.invitations;
DROP POLICY IF EXISTS "Insert invitations" ON public.invitations;
DROP POLICY IF EXISTS "Joiner accept invitation" ON public.invitations;
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can insert shifts in their organization" ON public.shifts;
DROP POLICY IF EXISTS "Users can insert staffs in their org" ON public.staffs;
REVOKE INSERT, UPDATE, DELETE ON public.organization_members FROM authenticated;
REVOKE ALL ON public.invitations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.invitations FROM authenticated;
DROP POLICY IF EXISTS "Hide deleted shifts" ON public.shifts;
CREATE POLICY "Hide deleted shifts" ON public.shifts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (deleted_at IS NULL);
DROP POLICY IF EXISTS "Hide deleted shift patterns" ON public.shift_patterns;
CREATE POLICY "Hide deleted shift patterns" ON public.shift_patterns AS RESTRICTIVE FOR SELECT TO authenticated
  USING (deleted_at IS NULL);
REVOKE DELETE ON public.shifts FROM authenticated;
REVOKE DELETE ON public.shift_patterns FROM authenticated;

-- public schemaの全テーブルでRLSを必須化。個別ポリシーがないテーブルはdefault denyとなる。
DO $$ DECLARE relation record; BEGIN
  FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation.tablename);
  END LOOP;
END $$;

-- 期限切れ一時データを安全に掃除するための索引。
CREATE INDEX IF NOT EXISTS oauth_nonces_expiry_idx ON public.oauth_nonces(expires_at);
CREATE INDEX IF NOT EXISTS invitations_expiry_idx ON public.invitations(expires_at) WHERE is_used = false;

CREATE OR REPLACE FUNCTION public.accept_invitation_atomic(p_code text, p_session_id text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  invite public.invitations%ROWTYPE;
  granted_role text;
  client_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO invite FROM public.invitations i
   WHERE i.code=p_code AND i.is_used=false AND i.expires_at>now() FOR UPDATE;
  IF invite.id IS NULL THEN RAISE EXCEPTION 'invitation_invalid'; END IF;
  granted_role := CASE WHEN invite.role IN ('manager','staff') THEN invite.role ELSE 'staff' END;
  UPDATE public.invitations SET is_used=true WHERE id=invite.id AND is_used=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_already_used'; END IF;
  INSERT INTO public.organization_members(organization_id,user_id,role)
    VALUES(invite.organization_id,actor,granted_role) ON CONFLICT DO NOTHING;
  IF invite.target_client_ids IS NOT NULL THEN
    FOR client_id IN SELECT jsonb_array_elements_text(to_jsonb(invite.target_client_ids))::uuid LOOP
      IF EXISTS(SELECT 1 FROM public.clients c WHERE c.id=client_id AND c.organization_id=invite.organization_id) THEN
        INSERT INTO public.assignments(helper_id,client_id) VALUES(actor,client_id) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  UPDATE public.profiles SET last_organization_id=invite.organization_id WHERE id=actor;
  INSERT INTO public.audit_events(organization_id,actor_id,action_type,resource_type,resource_id,outcome,session_id,details)
    VALUES(invite.organization_id,actor,'account.invitation_accept','invitation',invite.id::text,'success',p_session_id,
      jsonb_build_object('role',granted_role));
  RETURN invite.organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_invitation_atomic(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation_atomic(text,text) TO authenticated;

-- 運用証跡。本文に医療情報を入れず、原本参照・ハッシュ・承認を保持する。
CREATE TABLE IF NOT EXISTS public.compliance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), control_id text NOT NULL,
  evidence_type text NOT NULL, artifact_uri text NOT NULL, artifact_sha256 text NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, notes text
);
CREATE TABLE IF NOT EXISTS public.security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL CHECK(severity IN('critical','high','medium','low')),
  status text NOT NULL CHECK(status IN('open','contained','recovered','closed')),
  detected_at timestamptz NOT NULL, contained_at timestamptz, closed_at timestamptz,
  summary text NOT NULL, personal_data_impact text, regulator_reference text,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.backup_restore_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), performed_at timestamptz NOT NULL,
  environment text NOT NULL, backup_reference text NOT NULL, expected_rpo_minutes integer NOT NULL,
  achieved_rpo_minutes integer, expected_rto_minutes integer NOT NULL, achieved_rto_minutes integer,
  integrity_verified boolean NOT NULL DEFAULT false, result text NOT NULL CHECK(result IN('pass','fail')),
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, notes text
);
CREATE TABLE IF NOT EXISTS public.vendor_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_name text NOT NULL UNIQUE,
  service_name text NOT NULL, data_categories text[] NOT NULL DEFAULT '{}', processing_countries text[] NOT NULL DEFAULT '{}',
  subprocessors_uri text, security_assessment_uri text, contract_reviewed_at timestamptz,
  next_review_at timestamptz, exit_plan text NOT NULL, approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.compliance_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), risk_key text NOT NULL UNIQUE, description text NOT NULL,
  likelihood smallint NOT NULL CHECK(likelihood BETWEEN 1 AND 5), impact smallint NOT NULL CHECK(impact BETWEEN 1 AND 5),
  treatment text NOT NULL, status text NOT NULL CHECK(status IN('open','mitigating','accepted','closed')),
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, due_at timestamptz,
  accepted_until timestamptz, approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.compliance_risks(risk_key,description,likelihood,impact,treatment,status,due_at,accepted_until)
VALUES('AUTH-2FA-EXEMPT','二要素認証を今回の準拠化対象から一時的に除外',3,5,
       '短時間セッション、レート制限、操作監査による代替策。期限到来時に再評価','accepted',
       now()+interval '180 days',now()+interval '180 days')
ON CONFLICT(risk_key) DO NOTHING;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_evidence','security_incidents','backup_restore_tests','vendor_registry','compliance_risks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.audit_archive_checkpoints (
  destination text PRIMARY KEY, last_created_at timestamptz, last_event_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_archive_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_archive_checkpoints FROM anon,authenticated;
