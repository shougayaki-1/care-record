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
