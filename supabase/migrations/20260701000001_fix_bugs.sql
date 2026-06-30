-- BUG-1: accept_invitation_atomic — target_client_ids は uuid[] なのに
--        jsonb_typeof / jsonb_array_elements_text を呼んでいた。
--        非NULL の target_client_ids を持つ招待承諾が全件エラーになる。
CREATE OR REPLACE FUNCTION "public"."accept_invitation_atomic"("p_code" "text", "p_session_id" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inv public.invitations%ROWTYPE;
  v_role_id uuid;
  v_existing_profile_name text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_inv
    FROM public.invitations
   WHERE code = p_code
     AND is_used = false
     AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_invalid'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE organization_id = v_inv.organization_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_inv.organization_id, v_actor, 'member')
  ON CONFLICT DO NOTHING;

  IF v_inv.role_ids IS NOT NULL THEN
    FOREACH v_role_id IN ARRAY v_inv.role_ids LOOP
      INSERT INTO public.organization_member_roles (organization_id, user_id, role_id)
      VALUES (v_inv.organization_id, v_actor, v_role_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- 修正: uuid[] を jsonb として扱っていたバグ。unnest() で直接展開。
  IF v_inv.target_client_ids IS NOT NULL AND array_length(v_inv.target_client_ids, 1) > 0 THEN
    INSERT INTO public.assignments (client_id, helper_id)
    SELECT unnest(v_inv.target_client_ids), v_actor
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT name INTO v_existing_profile_name
    FROM public.profiles
   WHERE id = v_actor;

  INSERT INTO public.profiles (id, name, last_organization_id)
  VALUES (
    v_actor,
    COALESCE(
      NULLIF(trim(v_existing_profile_name::text), ''),
      NULLIF(trim(v_inv.target_name::text), '')
    ),
    v_inv.organization_id
  )
  ON CONFLICT (id) DO UPDATE SET
    name = CASE
      WHEN NULLIF(trim(profiles.name::text), '') IS NULL
        THEN EXCLUDED.name
      ELSE profiles.name
    END,
    last_organization_id = EXCLUDED.last_organization_id;

  IF v_inv.staff_id IS NOT NULL THEN
    UPDATE public.staffs
       SET user_id = v_actor
     WHERE id = v_inv.staff_id
       AND organization_id = v_inv.organization_id
       AND user_id IS NULL
       AND deleted_at IS NULL;
  END IF;

  UPDATE public.invitations SET is_used = true WHERE id = v_inv.id AND is_used = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_already_used'; END IF;

  INSERT INTO public.audit_events (organization_id, actor_id, action_type, resource_type, resource_id, outcome, session_id, details)
  VALUES (
    v_inv.organization_id, v_actor,
    'account.invitation_accept', 'invitation', v_inv.id::text,
    'success', p_session_id,
    jsonb_build_object(
      'role', 'member',
      'role_ids', to_jsonb(v_inv.role_ids::uuid[]),
      'staff_id', v_inv.staff_id::text,
      'profileNameInitialized', NULLIF(trim(COALESCE(v_existing_profile_name::text, '')), '') IS NULL
    )
  );

  RETURN v_inv.organization_id;
END;
$$;


-- BUG-2: get_my_org_id — profiles に organization_id カラムが存在しない
--        (last_organization_id が正しいカラム名)
CREATE OR REPLACE FUNCTION "public"."get_my_org_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
declare
  org_id uuid;
begin
  select last_organization_id into org_id
  from public.profiles
  where id = auth.uid();
  return org_id;
end;
$$;


-- BUG-3: is_super_admin — profiles に role カラムが存在しない。
--        スーパー管理者機能は未実装のため false を返す。
CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
  SELECT false;
$$;


-- BUG-4: can_access_client — staff_id 経由のアサインを無視していた。
--        staff_id でアサインされたユーザーは記録を作れても読めない矛盾を修正。
CREATE OR REPLACE FUNCTION "private"."can_access_client"("p_client_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.clients c
    JOIN public.organization_members om ON om.organization_id = c.organization_id
    WHERE c.id = p_client_id
      AND c.deleted_at IS NULL
      AND om.user_id = auth.uid()
      AND (
        om.role IN ('owner', 'manager')
        OR EXISTS (
          SELECT 1 FROM public.assignments a
          WHERE a.client_id = c.id AND a.helper_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.assignments a
          JOIN public.staffs st ON st.id = a.staff_id
          WHERE a.client_id = c.id
            AND st.user_id = auth.uid()
            AND st.organization_id = c.organization_id
            AND st.deleted_at IS NULL
        )
      )
  )
$$;


-- BUG-5: capture_report_version — care_record.skip_version フラグを確認せず、
--        save_report_atomic から呼ばれるたびに不完全なバージョンを余分に作っていた。
CREATE OR REPLACE FUNCTION "public"."capture_report_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  target_org_id uuid;
  next_version bigint;
BEGIN
  IF current_setting('care_record.skip_version', true) = 'on' THEN
    RETURN NEW;
  END IF;

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


-- BUG-5 (続き): capture_report_values_version も同様に skip_version を確認する。
CREATE OR REPLACE FUNCTION "public"."capture_report_values_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  target_org_id uuid;
  next_version bigint;
BEGIN
  IF current_setting('care_record.skip_version', true) = 'on' THEN
    RETURN NEW;
  END IF;

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


-- BUG-6: is_org_admin — organization_members.role に 'manager' は格納できないため
--        'manager' チェックは永遠に false だった。
--        organization_roles 経由の管理権限（いずれかの主要権限が 'all'）も admin とみなす。
CREATE OR REPLACE FUNCTION "public"."is_org_admin"("_org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = _org_id
      AND user_id = auth.uid()
      AND role = 'owner'
  ) OR EXISTS (
    SELECT 1 FROM organization_member_roles omr
    JOIN organization_roles r ON r.id = omr.role_id
    WHERE omr.organization_id = _org_id
      AND omr.user_id = auth.uid()
      AND (
        (r.permissions -> 'records' ->> 'create')   = 'all'
        OR (r.permissions -> 'records' ->> 'edit')   = 'all'
        OR (r.permissions -> 'records' ->> 'approve') = 'all'
        OR (r.permissions -> 'shifts'  ->> 'create') = 'all'
      )
  );
END;
$$;


-- BUG-7: reports.shift_id に FK 制約が欠落していた。
--        NOT VALID で既存データのスキャンをスキップし、新規データにのみ即時適用。
ALTER TABLE ONLY "public"."reports"
  ADD CONSTRAINT "reports_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id")
  ON DELETE SET NULL
  NOT VALID;


-- BUG-8: shift_staffs の INSERT/DELETE が一般メンバー全員に開放されていた。
--        シフト担当者管理は admin (is_org_admin) のみに制限。
DROP POLICY IF EXISTS "Users can insert shift_staffs in their org" ON "public"."shift_staffs";
DROP POLICY IF EXISTS "Users can delete shift_staffs in their org" ON "public"."shift_staffs";

CREATE POLICY "Admins can insert shift_staffs" ON "public"."shift_staffs"
  FOR INSERT WITH CHECK (
    "shift_id" IN (
      SELECT s."id" FROM "public"."shifts" s
      WHERE "public"."is_org_admin"(s."organization_id")
    )
  );

CREATE POLICY "Admins can delete shift_staffs" ON "public"."shift_staffs"
  FOR DELETE USING (
    "shift_id" IN (
      SELECT s."id" FROM "public"."shifts" s
      WHERE "public"."is_org_admin"(s."organization_id")
    )
  );
