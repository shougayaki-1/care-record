


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES
  ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('report-images', 'report-images', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT ("id") DO UPDATE SET
  "public" = EXCLUDED."public",
  "file_size_limit" = EXCLUDED."file_size_limit",
  "allowed_mime_types" = EXCLUDED."allowed_mime_types";






CREATE OR REPLACE FUNCTION "private"."can_access_client"("p_client_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  WITH target AS (
    SELECT c.id, c.organization_id
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.deleted_at IS NULL
  ),
  scope AS (
    SELECT t.*, private.get_member_record_view_scope(t.organization_id, auth.uid()) AS value
    FROM target t
    WHERE EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = t.organization_id
        AND om.user_id = auth.uid()
    )
  )
  SELECT EXISTS (
    SELECT 1
    FROM scope s
    WHERE s.value = 'all'
      OR (
        s.value = 'assigned'
        AND private.is_assigned_client_for_user(s.id, s.organization_id, auth.uid())
      )
  );
$$;


ALTER FUNCTION "private"."can_access_client"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_access_report"("p_report_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS(SELECT 1 FROM public.reports r WHERE r.id=p_report_id AND r.deleted_at IS NULL
    AND private.can_access_client(r.client_id));
$$;


ALTER FUNCTION "private"."can_access_report"("p_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_access_shift"("p_shift_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  WITH target AS (
    SELECT s.id, s.organization_id, s.client_id
    FROM public.shifts s
    WHERE s.id = p_shift_id
      AND s.deleted_at IS NULL
  ),
  scope AS (
    SELECT t.*, private.get_member_shift_action_scope(t.organization_id, auth.uid(), 'view') AS value
    FROM target t
    WHERE EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = t.organization_id
        AND om.user_id = auth.uid()
    )
  )
  SELECT EXISTS (
    SELECT 1
    FROM scope s
    WHERE s.value = 'all'
      OR (
        s.value = 'assigned'
        AND (
          private.is_assigned_client_for_user(s.client_id, s.organization_id, auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.shift_staffs ss
            WHERE ss.shift_id = s.id
              AND ss.staff_id = private.get_actor_staff_id(s.organization_id, auth.uid())
          )
          OR EXISTS (
            SELECT 1
            FROM public.shift_segments seg
            JOIN public.shift_segment_staffs sss ON sss.segment_id = seg.id
            WHERE seg.shift_id = s.id
              AND sss.staff_id = private.get_actor_staff_id(s.organization_id, auth.uid())
          )
        )
      )
  );
$$;


ALTER FUNCTION "private"."can_access_shift"("p_shift_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_access_shift_pattern"("p_pattern_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
  WITH target AS (
    SELECT sp.id, sp.organization_id, sp.client_id
    FROM public.shift_patterns sp
    WHERE sp.id = p_pattern_id
      AND sp.deleted_at IS NULL
  ),
  scope AS (
    SELECT t.*, private.get_member_shift_action_scope(t.organization_id, auth.uid(), 'view') AS value
    FROM target t
    WHERE EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = t.organization_id
        AND om.user_id = auth.uid()
    )
  )
  SELECT EXISTS (
    SELECT 1
    FROM scope s
    WHERE s.value = 'all'
      OR (
        s.value = 'assigned'
        AND (
          private.is_assigned_client_for_user(s.client_id, s.organization_id, auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.shift_pattern_staffs sps
            WHERE sps.pattern_id = s.id
              AND sps.staff_id = private.get_actor_staff_id(s.organization_id, auth.uid())
          )
        )
      )
  )
$$;


ALTER FUNCTION "private"."can_access_shift_pattern"("p_pattern_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."capture_complete_report_version"("p_report_id" "uuid", "p_actor_id" "uuid", "p_change_reason" "text", "p_session_id" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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
         jsonb_build_object(
           'report', to_jsonb(r),
           'report_values', COALESCE(rv.data, '{}'::jsonb),
           'report_actual_staffs', COALESCE(
             (
               SELECT jsonb_agg(to_jsonb(ras) ORDER BY ras.sort_order, ras.created_at)
                 FROM public.report_actual_staffs ras
                WHERE ras.report_id = r.id
             ),
             '[]'::jsonb
           )
         )
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


ALTER FUNCTION "private"."capture_complete_report_version"("p_report_id" "uuid", "p_actor_id" "uuid", "p_change_reason" "text", "p_session_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."chain_audit_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
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


ALTER FUNCTION "private"."chain_audit_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."get_actor_staff_id"("p_org_id" "uuid", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
  SELECT st.id
  FROM public.staffs st
  WHERE st.organization_id = p_org_id
    AND st.user_id = p_user_id
    AND st.deleted_at IS NULL
  ORDER BY st.sort_order NULLS LAST, st.name
  LIMIT 1
$$;


ALTER FUNCTION "private"."get_actor_staff_id"("p_org_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."get_member_record_action_scope"("p_org_id" "uuid", "p_user_id" "uuid", "p_action" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN om.role = 'owner' THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'records' ->> p_action) = 'all'
        ) THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'records' ->> p_action) = 'assigned'
        ) THEN 'assigned'
        ELSE 'none'
      END
      FROM public.organization_members om
      WHERE om.organization_id = p_org_id
        AND om.user_id = p_user_id
    ),
    'none'
  )
$$;


ALTER FUNCTION "private"."get_member_record_action_scope"("p_org_id" "uuid", "p_user_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."get_member_record_view_scope"("p_org_id" "uuid", "p_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
  SELECT private.get_member_record_action_scope(p_org_id, p_user_id, 'view')
$$;


ALTER FUNCTION "private"."get_member_record_view_scope"("p_org_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."get_member_shift_action_scope"("p_org_id" "uuid", "p_user_id" "uuid", "p_action" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN om.role = 'owner' THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'shifts' ->> p_action) = 'all'
        ) THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'shifts' ->> p_action) = 'assigned'
        ) THEN 'assigned'
        ELSE 'none'
      END
      FROM public.organization_members om
      WHERE om.organization_id = p_org_id
        AND om.user_id = p_user_id
    ),
    'none'
  )
$$;


ALTER FUNCTION "private"."get_member_shift_action_scope"("p_org_id" "uuid", "p_user_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_assigned_client_for_user"("p_client_id" "uuid", "p_org_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    WHERE a.client_id = p_client_id
      AND (
        a.helper_id = p_user_id
        OR a.staff_id = private.get_actor_staff_id(p_org_id, p_user_id)
      )
  )
$$;


ALTER FUNCTION "private"."is_assigned_client_for_user"("p_client_id" "uuid", "p_org_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_org_member"("p_org_id" "uuid", "p_roles" "text"[] DEFAULT NULL::"text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS(SELECT 1 FROM public.organization_members om
    WHERE om.organization_id=p_org_id AND om.user_id=auth.uid()
      AND (p_roles IS NULL OR om.role=ANY(p_roles)));
$$;


ALTER FUNCTION "private"."is_org_member"("p_org_id" "uuid", "p_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_session_active"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_session_activity usa
     WHERE usa.user_id=auth.uid() AND usa.auth_session_id=(auth.jwt()->>'session_id')
       AND usa.revoked_at IS NULL AND usa.last_activity >= now()-interval '24 hours'
       AND usa.absolute_expires_at > now()
  );
$$;


ALTER FUNCTION "private"."is_session_active"() OWNER TO "postgres";


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

  -- 既参加チェック: 招待を消費せず例外を返す
  IF EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE organization_id = v_inv.organization_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  -- メンバー追加
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_inv.organization_id, v_actor, 'member')
  ON CONFLICT DO NOTHING;

  -- ロール割り当て
  IF v_inv.role_ids IS NOT NULL THEN
    FOREACH v_role_id IN ARRAY v_inv.role_ids LOOP
      INSERT INTO public.organization_member_roles (organization_id, user_id, role_id)
      VALUES (v_inv.organization_id, v_actor, v_role_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- 担当クライアント割り当て
  IF v_inv.target_client_ids IS NOT NULL AND cardinality(v_inv.target_client_ids) > 0 THEN
    INSERT INTO public.assignments (client_id, helper_id)
    SELECT elem, v_actor
      FROM unnest(v_inv.target_client_ids) AS elem
    ON CONFLICT DO NOTHING;
  END IF;

  -- プロファイル名取得
  SELECT name INTO v_existing_profile_name
    FROM public.profiles
   WHERE id = v_actor;

  -- プロファイルの更新（型の曖昧さを ::text で排除）
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

  -- スタッフ名簿への紐付け
  IF v_inv.staff_id IS NOT NULL THEN
    UPDATE public.staffs
       SET user_id = v_actor
     WHERE id = v_inv.staff_id
       AND organization_id = v_inv.organization_id
       AND user_id IS NULL
       AND deleted_at IS NULL;
  END IF;

  -- 招待の使用フラグ更新
  UPDATE public.invitations SET is_used = true WHERE id = v_inv.id AND is_used = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_already_used'; END IF;

  -- 監査ログの記録（uuid等のキャストを明示して jsonb_build_object での解決エラーを防止）
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


ALTER FUNCTION "public"."accept_invitation_atomic"("p_code" "text", "p_session_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_report_values_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  target_org_id uuid;
  next_version bigint;
BEGIN
  IF current_setting('care_record.skip_version', true) = 'on' THEN RETURN NEW; END IF;

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


ALTER FUNCTION "public"."capture_report_values_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_report_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  target_org_id uuid;
  next_version bigint;
BEGIN
  IF current_setting('care_record.skip_version', true) = 'on' THEN RETURN NEW; END IF;

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


ALTER FUNCTION "public"."capture_report_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_organization"("org_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- A. 事業所を作成
  INSERT INTO organizations (name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;

  -- B. 作成者をオーナーとしてメンバーに追加
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (new_org_id, auth.uid(), 'owner');

  -- 作成したIDを返す
  RETURN new_org_id;
END;
$$;


ALTER FUNCTION "public"."create_organization"("org_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_org_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
declare
  org_id uuid;
begin
  select organization_id into org_id
  from public.organization_members
  where user_id = auth.uid()
  order by created_at
  limit 1;
  return org_id;
end;
$$;


ALTER FUNCTION "public"."get_my_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    COALESCE(NULLIF(new.raw_user_meta_data->>'name', ''), NULLIF(new.email, ''), '名前未設定')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();


CREATE OR REPLACE FUNCTION "public"."is_org_admin"("_org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = _org_id AND user_id = auth.uid() AND role = 'owner'
  );
END;
$$;


ALTER FUNCTION "public"."is_org_admin"("_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member"("_org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = _org_id AND user_id = auth.uid()
  );
END;
$$;


ALTER FUNCTION "public"."is_org_member"("_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  );
end;
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_audit_event_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;


ALTER FUNCTION "public"."prevent_audit_event_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_report_atomic"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text" DEFAULT NULL::"text", "p_actual_service_type_id" "uuid" DEFAULT NULL::"uuid", "p_actual_staffs" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  actor uuid := auth.uid();
  target uuid := p_report_id;
  previous_status text;
  existing_helper uuid;
  existing_shift_id uuid;
  existing_segment_id uuid;
  effective_shift_id uuid := p_shift_id;
  effective_segment_id uuid := p_segment_id;
  segment_shift_id uuid;
  actor_staff_id uuid;
  create_scope text;
  edit_scope text;
  approve_scope text;
  required_scope text;
  normalized_actual_staffs jsonb := COALESCE(p_actual_staffs, '[]'::jsonb);
  actual_staff_count int;
  distinct_actual_staff_count int;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_end_at <= p_start_at THEN RAISE EXCEPTION 'invalid_period'; END IF;
  IF p_status NOT IN ('draft', 'pending', 'approved', 'remanded') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF octet_length(p_values::text) > 1000000 THEN RAISE EXCEPTION 'values_too_large'; END IF;
  IF jsonb_typeof(normalized_actual_staffs) <> 'array' THEN RAISE EXCEPTION 'invalid_actual_staffs'; END IF;

  SELECT jsonb_array_length(normalized_actual_staffs) INTO actual_staff_count;
  IF actual_staff_count > 50 THEN RAISE EXCEPTION 'too_many_actual_staffs'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = p_organization_id
       AND om.user_id = actor
  ) THEN RAISE EXCEPTION 'access_denied'; END IF;

  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'create') INTO create_scope;
  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'edit') INTO edit_scope;
  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'approve') INTO approve_scope;

  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id AND c.organization_id = p_organization_id AND c.deleted_at IS NULL)
    THEN RAISE EXCEPTION 'client_not_found'; END IF;

  IF p_actual_service_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_types st
     WHERE st.id = p_actual_service_type_id
       AND st.organization_id = p_organization_id
       AND st.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'invalid_actual_service_type'; END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(normalized_actual_staffs) item
     WHERE jsonb_typeof(item) <> 'object'
        OR COALESCE(item->>'staff_id', '') = ''
  ) THEN RAISE EXCEPTION 'invalid_actual_staffs'; END IF;

  WITH actual_staff_rows AS (
    SELECT
      (item->>'staff_id')::uuid AS staff_id,
      NULLIF(item->>'staff_role_id', '')::uuid AS staff_role_id
    FROM jsonb_array_elements(normalized_actual_staffs) item
  )
  SELECT count(*), count(DISTINCT staff_id)
    INTO actual_staff_count, distinct_actual_staff_count
    FROM actual_staff_rows;

  IF EXISTS (
    WITH actual_staff_rows AS (
      SELECT (item->>'staff_id')::uuid AS staff_id
      FROM jsonb_array_elements(normalized_actual_staffs) item
    )
    SELECT 1
      FROM actual_staff_rows ast
      LEFT JOIN public.staffs s
        ON s.id = ast.staff_id
       AND s.organization_id = p_organization_id
       AND s.deleted_at IS NULL
     WHERE s.id IS NULL
  ) THEN RAISE EXCEPTION 'invalid_actual_staff'; END IF;

  IF EXISTS (
    WITH actual_staff_rows AS (
      SELECT NULLIF(item->>'staff_role_id', '')::uuid AS staff_role_id
      FROM jsonb_array_elements(normalized_actual_staffs) item
    )
    SELECT 1
      FROM actual_staff_rows ast
      LEFT JOIN public.staff_roles sr
        ON sr.id = ast.staff_role_id
       AND sr.organization_id = p_organization_id
       AND sr.deleted_at IS NULL
     WHERE ast.staff_role_id IS NOT NULL
       AND sr.id IS NULL
  ) THEN RAISE EXCEPTION 'invalid_actual_staff_role'; END IF;

  IF actual_staff_count <> distinct_actual_staff_count THEN RAISE EXCEPTION 'duplicate_actual_staff'; END IF;

  SELECT st.id INTO actor_staff_id
    FROM public.staffs st
   WHERE st.organization_id = p_organization_id
     AND st.user_id = actor
     AND st.deleted_at IS NULL
   ORDER BY st.sort_order NULLS LAST, st.name
   LIMIT 1;

  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
     WHERE s.id = p_shift_id
       AND s.organization_id = p_organization_id
       AND s.client_id = p_client_id
       AND s.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'shift_not_found'; END IF;

  IF p_segment_id IS NOT NULL THEN
    SELECT ss.shift_id INTO segment_shift_id
      FROM public.shift_segments ss
      JOIN public.shifts s ON s.id = ss.shift_id
     WHERE ss.id = p_segment_id
       AND s.organization_id = p_organization_id
       AND s.client_id = p_client_id
       AND s.deleted_at IS NULL;
    IF segment_shift_id IS NULL THEN RAISE EXCEPTION 'segment_not_found'; END IF;
    IF p_shift_id IS NOT NULL AND p_shift_id <> segment_shift_id THEN RAISE EXCEPTION 'segment_shift_mismatch'; END IF;
    effective_shift_id := COALESCE(effective_shift_id, segment_shift_id);
  END IF;

  PERFORM set_config('care_record.skip_version', 'on', true);
  IF target IS NULL THEN
    IF p_status IN ('approved', 'remanded') THEN RAISE EXCEPTION 'invalid_initial_status'; END IF;
    required_scope := create_scope;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;

    IF required_scope = 'assigned'
       AND NOT EXISTS (
         SELECT 1 FROM public.assignments a
          WHERE a.client_id = p_client_id
            AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
       )
       AND NOT (
         actor_staff_id IS NOT NULL
         AND (
           EXISTS (
             SELECT 1 FROM public.shifts s
             JOIN public.shift_staffs ss ON ss.shift_id = s.id
              WHERE s.client_id = p_client_id
                AND s.organization_id = p_organization_id
                AND s.deleted_at IS NULL
                AND s.status <> 'cancelled'
                AND ss.staff_id = actor_staff_id
           )
           OR EXISTS (
             SELECT 1 FROM public.shifts s
             JOIN public.shift_segments seg ON seg.shift_id = s.id
             JOIN public.shift_segment_staffs sss ON sss.segment_id = seg.id
              WHERE s.client_id = p_client_id
                AND s.organization_id = p_organization_id
                AND s.deleted_at IS NULL
                AND s.status <> 'cancelled'
                AND sss.staff_id = actor_staff_id
           )
         )
       )
    THEN RAISE EXCEPTION 'access_denied'; END IF;

    IF effective_shift_id IS NULL AND actor_staff_id IS NOT NULL THEN
      SELECT s.id INTO effective_shift_id
        FROM public.shifts s
       WHERE s.organization_id = p_organization_id
         AND s.client_id = p_client_id
         AND s.status <> 'cancelled'
         AND s.deleted_at IS NULL
         AND s.start_at < p_end_at
         AND s.end_at > p_start_at
         AND (
           EXISTS (
             SELECT 1 FROM public.shift_staffs ss
              WHERE ss.shift_id = s.id AND ss.staff_id = actor_staff_id
           )
           OR EXISTS (
             SELECT 1 FROM public.shift_segments seg
             JOIN public.shift_segment_staffs sss ON sss.segment_id = seg.id
              WHERE seg.shift_id = s.id AND sss.staff_id = actor_staff_id
           )
         )
       ORDER BY
         abs(extract(epoch FROM (s.start_at - p_start_at))) + abs(extract(epoch FROM (s.end_at - p_end_at))),
         s.start_at
       LIMIT 1;
    END IF;

    IF effective_shift_id IS NULL THEN
      WITH candidates AS (
        SELECT s.id
          FROM public.shifts s
         WHERE s.organization_id = p_organization_id
           AND s.client_id = p_client_id
           AND s.status <> 'cancelled'
           AND s.deleted_at IS NULL
           AND s.start_at < p_end_at
           AND s.end_at > p_start_at
      )
      -- ▼ 修正箇所：min(id) → min(id::text)::uuid
      SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid ELSE NULL END
        INTO effective_shift_id
        FROM candidates;
    END IF;

    INSERT INTO public.reports(client_id, helper_id, start_at, end_at, status, shift_id, segment_id, actual_service_type_id, updated_at)
    VALUES (p_client_id, actor, p_start_at, p_end_at, p_status, effective_shift_id, effective_segment_id, p_actual_service_type_id, now()) RETURNING id INTO target;
    INSERT INTO public.report_values(report_id, data) VALUES(target, p_values);
  ELSE
    SELECT r.status, r.helper_id, r.shift_id, r.segment_id
      INTO previous_status, existing_helper, existing_shift_id, existing_segment_id
      FROM public.reports r JOIN public.clients c ON c.id = r.client_id
     WHERE r.id = target AND r.client_id = p_client_id AND c.organization_id = p_organization_id
       AND r.deleted_at IS NULL FOR UPDATE;
    IF previous_status IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;
    IF previous_status = 'approved' AND p_status <> 'remanded' THEN RAISE EXCEPTION 'approved_report_locked'; END IF;

    required_scope := CASE WHEN p_status IN ('approved', 'remanded') THEN approve_scope ELSE edit_scope END;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;

    IF required_scope = 'assigned'
       AND existing_helper IS DISTINCT FROM actor
       AND NOT EXISTS (
         SELECT 1 FROM public.assignments a
          WHERE a.client_id = p_client_id
            AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
       )
       AND NOT (
         actor_staff_id IS NOT NULL
         AND (
           EXISTS (
             SELECT 1 FROM public.shifts s
             JOIN public.shift_staffs ss ON ss.shift_id = s.id
              WHERE s.client_id = p_client_id
                AND s.organization_id = p_organization_id
                AND s.deleted_at IS NULL
                AND s.status <> 'cancelled'
                AND ss.staff_id = actor_staff_id
           )
           OR EXISTS (
             SELECT 1 FROM public.shifts s
             JOIN public.shift_segments seg ON seg.shift_id = s.id
             JOIN public.shift_segment_staffs sss ON sss.segment_id = seg.id
              WHERE s.client_id = p_client_id
                AND s.organization_id = p_organization_id
                AND s.deleted_at IS NULL
                AND s.status <> 'cancelled'
                AND sss.staff_id = actor_staff_id
           )
         )
       )
    THEN RAISE EXCEPTION 'access_denied'; END IF;

    effective_shift_id := COALESCE(p_shift_id, existing_shift_id);
    effective_segment_id := COALESCE(p_segment_id, existing_segment_id);
    IF effective_shift_id IS NULL THEN
      SELECT rs.shift_id INTO effective_shift_id
        FROM public.report_shifts rs
       WHERE rs.report_id = target
         AND rs.is_primary = true
       ORDER BY rs.created_at
       LIMIT 1;
    END IF;

    UPDATE public.reports SET start_at=p_start_at, end_at=p_end_at, status=p_status,
      shift_id=effective_shift_id, segment_id=effective_segment_id, actual_service_type_id=p_actual_service_type_id, updated_at=now(),
      approved_by=CASE WHEN p_status='approved' THEN actor WHEN p_status='remanded' THEN NULL ELSE approved_by END,
      approved_at=CASE WHEN p_status='approved' THEN now() WHEN p_status='remanded' THEN NULL ELSE approved_at END
     WHERE id=target;
    IF EXISTS (SELECT 1 FROM public.report_values rv WHERE rv.report_id=target) THEN
      UPDATE public.report_values SET data=p_values WHERE report_id=target;
    ELSE
      INSERT INTO public.report_values(report_id,data) VALUES(target,p_values);
    END IF;
  END IF;

  DELETE FROM public.report_actual_staffs WHERE report_id = target;
  INSERT INTO public.report_actual_staffs(report_id, staff_id, staff_role_id, sort_order)
  SELECT
    target,
    (item.value->>'staff_id')::uuid,
    NULLIF(item.value->>'staff_role_id', '')::uuid,
    item.ordinality::int - 1
  FROM jsonb_array_elements(normalized_actual_staffs) WITH ORDINALITY AS item(value, ordinality);

  IF effective_shift_id IS NOT NULL THEN
    UPDATE public.report_shifts
       SET is_primary = false
     WHERE report_id = target
       AND is_primary = true
       AND shift_id <> effective_shift_id;

    INSERT INTO public.report_shifts(report_id, shift_id, is_primary)
    VALUES (target, effective_shift_id, true)
    ON CONFLICT (report_id, shift_id)
    DO UPDATE SET is_primary = true;
  END IF;

  PERFORM private.capture_complete_report_version(target, actor, CASE WHEN p_report_id IS NULL THEN 'create' ELSE 'update:'||p_status END, p_session_id);
  INSERT INTO public.audit_events(organization_id,actor_id,action_type,resource_type,resource_id,outcome,session_id,details)
  VALUES(p_organization_id,actor,CASE WHEN p_report_id IS NULL THEN 'report.create' ELSE 'report.'||p_status END,
    'report',target::text,'success',p_session_id,jsonb_build_object('previousStatus',previous_status,'newStatus',p_status,'shiftId',effective_shift_id,'segmentId',effective_segment_id));
  RETURN target;
END;
$$;


ALTER FUNCTION "public"."save_report_atomic"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text", "p_actual_service_type_id" "uuid", "p_actual_staffs" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_report_atomic_v2"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text" DEFAULT NULL::"text", "p_actual_service_type_id" "uuid" DEFAULT NULL::"uuid", "p_actual_staffs" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT public.save_report_atomic(
    p_organization_id,
    p_report_id,
    p_client_id,
    p_shift_id,
    p_segment_id,
    p_start_at,
    p_end_at,
    p_status,
    p_values,
    p_session_id,
    p_actual_service_type_id,
    p_actual_staffs
  );
$$;


ALTER FUNCTION "public"."save_report_atomic_v2"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text", "p_actual_service_type_id" "uuid", "p_actual_staffs" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_owner_atomic"("p_org_id" "uuid", "p_new_owner_id" "uuid", "p_current_owner_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'private', 'public'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = p_org_id AND user_id = p_current_owner_id AND role = 'owner') THEN RAISE EXCEPTION 'オーナー権限がありません'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = p_org_id AND user_id = p_new_owner_id) THEN RAISE EXCEPTION '移譲先がメンバーではありません'; END IF;
  UPDATE public.organization_members SET role = 'member' WHERE organization_id = p_org_id AND user_id = p_current_owner_id;
  UPDATE public.organization_members SET role = 'owner' WHERE organization_id = p_org_id AND user_id = p_new_owner_id;
END;
$$;


ALTER FUNCTION "public"."transfer_owner_atomic"("p_org_id" "uuid", "p_new_owner_id" "uuid", "p_current_owner_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "helper_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "ghost_staff_id" "uuid",
    "staff_id" "uuid",
    "round_trip_distance_km" numeric(8,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "assignments_round_trip_distance_km_check" CHECK ((("round_trip_distance_km" >= (0)::numeric) AND ("round_trip_distance_km" <= (1000)::numeric)))
);


ALTER TABLE "public"."assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_archive_checkpoints" (
    "destination" "text" NOT NULL,
    "last_created_at" timestamp with time zone,
    "last_event_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_archive_checkpoints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "actor_id" "uuid",
    "action_type" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "outcome" "text" DEFAULT 'success'::"text" NOT NULL,
    "request_id" "text",
    "ip_hash" "text",
    "user_agent" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "text",
    "reason" "text",
    "previous_hash" "text",
    "event_hash" "text",
    "integrity_version" smallint DEFAULT 1 NOT NULL,
    CONSTRAINT "audit_events_outcome_check" CHECK (("outcome" = ANY (ARRAY['success'::"text", 'failure'::"text"])))
);


ALTER TABLE "public"."audit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "actor_id" "uuid",
    "action_type" "text" NOT NULL,
    "target_resource" "text",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backup_restore_tests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "performed_at" timestamp with time zone NOT NULL,
    "environment" "text" NOT NULL,
    "backup_reference" "text" NOT NULL,
    "expected_rpo_minutes" integer NOT NULL,
    "achieved_rpo_minutes" integer,
    "expected_rto_minutes" integer NOT NULL,
    "achieved_rto_minutes" integer,
    "integrity_verified" boolean DEFAULT false NOT NULL,
    "result" "text" NOT NULL,
    "approved_by" "uuid",
    "notes" "text",
    CONSTRAINT "backup_restore_tests_result_check" CHECK (("result" = ANY (ARRAY['pass'::"text", 'fail'::"text"])))
);


ALTER TABLE "public"."backup_restore_tests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "google_folder_id" "text",
    "google_template_id" "text",
    "archived_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    "retention_until" timestamp with time zone
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compliance_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "control_id" "text" NOT NULL,
    "evidence_type" "text" NOT NULL,
    "artifact_uri" "text" NOT NULL,
    "artifact_sha256" "text" NOT NULL,
    "collected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valid_until" timestamp with time zone,
    "approved_by" "uuid",
    "notes" "text"
);


ALTER TABLE "public"."compliance_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compliance_risks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "risk_key" "text" NOT NULL,
    "description" "text" NOT NULL,
    "likelihood" smallint NOT NULL,
    "impact" smallint NOT NULL,
    "treatment" "text" NOT NULL,
    "status" "text" NOT NULL,
    "owner_id" "uuid",
    "due_at" timestamp with time zone,
    "accepted_until" timestamp with time zone,
    "approved_by" "uuid",
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "compliance_risks_impact_check" CHECK ((("impact" >= 1) AND ("impact" <= 5))),
    CONSTRAINT "compliance_risks_likelihood_check" CHECK ((("likelihood" >= 1) AND ("likelihood" <= 5))),
    CONSTRAINT "compliance_risks_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'mitigating'::"text", 'accepted'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."compliance_risks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deletion_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "requested_by" "uuid",
    "approved_by" "uuid",
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'requested'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "deletion_requests_status_check" CHECK (("status" = ANY (ARRAY['requested'::"text", 'approved'::"text", 'rejected'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."deletion_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "schema" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."form_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."internal_work_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "recorded_by" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "work_type" "text" DEFAULT 'meeting'::"text" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "work_hours" numeric(8,2) NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "internal_work_records_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'remanded'::"text"]))),
    CONSTRAINT "internal_work_records_work_hours_check" CHECK (("work_hours" > (0)::numeric))
);


ALTER TABLE "public"."internal_work_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "email" "text",
    "is_used" boolean DEFAULT false,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "target_name" "text",
    "target_client_ids" "uuid"[],
    "role" "text" DEFAULT 'staff'::"text",
    "expires_at" timestamp with time zone,
    "role_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "staff_id" "uuid",
    CONSTRAINT "invitations_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'staff'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."labor_premium_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "rate" numeric(5,4) NOT NULL,
    "calc_method" "text" NOT NULL,
    "builtin_type" "text",
    "night_start_hour" smallint,
    "night_end_hour" smallint,
    "overtime_daily_threshold_hours" numeric(4,2),
    "overtime_weekly_threshold_hours" numeric(4,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "variable_working_hours_enabled" boolean DEFAULT false NOT NULL,
    "variable_overtime_period" "text",
    "variable_overtime_threshold_hours" numeric(6,2),
    CONSTRAINT "labor_premium_types_builtin_type_check" CHECK (("builtin_type" = ANY (ARRAY['night'::"text", 'overtime'::"text", 'custom'::"text"]))),
    CONSTRAINT "labor_premium_types_calc_method_check" CHECK (("calc_method" = ANY (ARRAY['additive'::"text", 'multiplicative'::"text"]))),
    CONSTRAINT "labor_premium_types_night_end_hour_check" CHECK ((("night_end_hour" >= 0) AND ("night_end_hour" <= 23))),
    CONSTRAINT "labor_premium_types_night_start_hour_check" CHECK ((("night_start_hour" >= 0) AND ("night_start_hour" <= 23))),
    CONSTRAINT "labor_premium_types_variable_overtime_period_check" CHECK (("variable_overtime_period" = ANY (ARRAY['week'::"text", 'month'::"text"])))
);


ALTER TABLE "public"."labor_premium_types" OWNER TO "postgres";


COMMENT ON COLUMN "public"."labor_premium_types"."variable_working_hours_enabled" IS '変形労働時間制の時間外閾値を適用するか';



COMMENT ON COLUMN "public"."labor_premium_types"."variable_overtime_period" IS '変形労働時間制の集計期間。week または month';



COMMENT ON COLUMN "public"."labor_premium_types"."variable_overtime_threshold_hours" IS '変形労働時間制で割り増し対象となる期間内の超過時間';



CREATE TABLE IF NOT EXISTS "public"."login_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ip_hash" "text",
    "email_hash" "text",
    "outcome" "text" DEFAULT 'failure'::"text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "login_attempts_outcome_check" CHECK (("outcome" = ANY (ARRAY['success'::"text", 'failure'::"text"])))
);


ALTER TABLE "public"."login_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "is_read" boolean DEFAULT false,
    "link_url" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_nonces" (
    "nonce_hash" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."oauth_nonces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_member_roles" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL
);


ALTER TABLE "public"."organization_member_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "user_id" "uuid",
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "organization_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "is_preset" boolean DEFAULT false NOT NULL,
    "permissions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "google_folder_id" "text",
    "google_calendar_id" "text",
    "google_refresh_token" "text",
    "retention_years" smallint DEFAULT 5 NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "retention_until" timestamp with time zone,
    "travel_cost_rate_yen_per_km" numeric(8,2) DEFAULT 20 NOT NULL,
    CONSTRAINT "organizations_retention_years_check" CHECK ((("retention_years" >= 1) AND ("retention_years" <= 30))),
    CONSTRAINT "organizations_travel_cost_rate_yen_per_km_check" CHECK ((("travel_cost_rate_yen_per_km" >= (0)::numeric) AND ("travel_cost_rate_yen_per_km" <= (10000)::numeric)))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "last_organization_id" "uuid",
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "is_agreed" boolean DEFAULT false,
    "agreed_at" timestamp with time zone,
    "avatar_url" "text",
    "deleted_at" timestamp with time zone,
    "deletion_reason" "text",
    "role" "text",
    CONSTRAINT "profiles_role_check" CHECK ((("role" IS NULL) OR ("role" = 'super_admin'::"text")))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."record_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "version_number" bigint NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "actor_id" "uuid",
    "change_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "previous_hash" "text",
    "snapshot_hash" "text",
    "confirmed_by" "uuid",
    "session_id" "text"
);


ALTER TABLE "public"."record_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_actual_staffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "staff_role_id" "uuid",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."report_actual_staffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid",
    "storage_path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."report_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."report_shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."report_values" (
    "report_id" "uuid" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."report_values" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "helper_id" "uuid" NOT NULL,
    "service_date" "date",
    "start_time" time without time zone,
    "end_time" time without time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "start_at" timestamp with time zone,
    "end_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "shift_id" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    "retention_until" timestamp with time zone,
    "legal_hold_at" timestamp with time zone,
    "legal_hold_reason" "text",
    "segment_id" "uuid",
    "actual_service_type_id" "uuid",
    CONSTRAINT "reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'remanded'::"text", 'draft'::"text"])))
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."retention_policies" (
    "organization_id" "uuid" NOT NULL,
    "resource_type" "text" NOT NULL,
    "retention_years" smallint NOT NULL,
    "legal_basis" "text" NOT NULL,
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_by" "uuid",
    CONSTRAINT "retention_policies_retention_years_check" CHECK ((("retention_years" >= 1) AND ("retention_years" <= 30)))
);


ALTER TABLE "public"."retention_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."security_incidents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "severity" "text" NOT NULL,
    "status" "text" NOT NULL,
    "detected_at" timestamp with time zone NOT NULL,
    "contained_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "summary" "text" NOT NULL,
    "personal_data_impact" "text",
    "regulator_reference" "text",
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "security_incidents_severity_check" CHECK (("severity" = ANY (ARRAY['critical'::"text", 'high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "security_incidents_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'contained'::"text", 'recovered'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."security_incidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."service_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_pattern_segment_staffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "staff_role_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shift_pattern_segment_staffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_pattern_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pattern_id" "uuid" NOT NULL,
    "service_type_id" "uuid",
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shift_pattern_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_pattern_staffs" (
    "pattern_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL
);


ALTER TABLE "public"."shift_pattern_staffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_patterns" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "title" "text",
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "rrule" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "retention_until" timestamp with time zone
);


ALTER TABLE "public"."shift_patterns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_segment_staffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "segment_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "staff_role_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shift_segment_staffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_segments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "service_type_id" "uuid",
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shift_segments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shift_staffs" (
    "shift_id" "uuid" NOT NULL,
    "staff_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."shift_staffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shifts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "title" "text",
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "is_recurring" boolean DEFAULT false,
    "rrule" "text",
    "base_shift_id" "uuid",
    "status" "text" DEFAULT 'published'::"text",
    "cancel_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "google_event_id" "text",
    "pattern_id" "uuid",
    "is_modified" boolean DEFAULT false,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    "retention_until" timestamp with time zone,
    "legal_hold_at" timestamp with time zone,
    "google_sync_status" "text" DEFAULT 'pending_upsert'::"text",
    "google_sync_error" "text",
    "google_synced_at" timestamp with time zone,
    CONSTRAINT "shifts_google_sync_status_check" CHECK ((("google_sync_status" IS NULL) OR ("google_sync_status" = ANY (ARRAY['synced'::"text", 'pending_upsert'::"text", 'pending_delete'::"text", 'failed'::"text"]))))
);


ALTER TABLE "public"."shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_position_presets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."staff_position_presets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_unpaid" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."staff_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "positions" "text"[] DEFAULT '{}'::"text"[],
    "archived_at" timestamp with time zone,
    "sort_order" integer,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    "retention_until" timestamp with time zone,
    "employment_type" "text",
    "work_style" "text",
    CONSTRAINT "staffs_employment_type_check" CHECK ((("employment_type" IS NULL) OR ("employment_type" = ANY (ARRAY['常勤'::"text", '非常勤'::"text"])))),
    CONSTRAINT "staffs_work_style_check" CHECK ((("work_style" IS NULL) OR ("work_style" = ANY (ARRAY['兼務'::"text", '専従'::"text"]))))
);


ALTER TABLE "public"."staffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_deletion_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'requested'::"text" NOT NULL,
    "approved_by" "uuid",
    "decided_at" timestamp with time zone,
    "retention_basis" "text" NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "user_deletion_requests_status_check" CHECK (("status" = ANY (ARRAY['requested'::"text", 'approved'::"text", 'rejected'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."user_deletion_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_session_activity" (
    "session_hash" "text" NOT NULL,
    "auth_session_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_activity" timestamp with time zone DEFAULT "now"() NOT NULL,
    "absolute_expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone
);


ALTER TABLE "public"."user_session_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_registry" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_name" "text" NOT NULL,
    "service_name" "text" NOT NULL,
    "data_categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "processing_countries" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "subprocessors_uri" "text",
    "security_assessment_uri" "text",
    "contract_reviewed_at" timestamp with time zone,
    "next_review_at" timestamp with time zone,
    "exit_plan" "text" NOT NULL,
    "approved_by" "uuid"
);


ALTER TABLE "public"."vendor_registry" OWNER TO "postgres";


ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_client_id_helper_id_key" UNIQUE ("client_id", "helper_id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_archive_checkpoints"
    ADD CONSTRAINT "audit_archive_checkpoints_pkey" PRIMARY KEY ("destination");



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backup_restore_tests"
    ADD CONSTRAINT "backup_restore_tests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_evidence"
    ADD CONSTRAINT "compliance_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_risks"
    ADD CONSTRAINT "compliance_risks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_risks"
    ADD CONSTRAINT "compliance_risks_risk_key_key" UNIQUE ("risk_key");



ALTER TABLE ONLY "public"."deletion_requests"
    ADD CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staffs"
    ADD CONSTRAINT "ghost_staffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."internal_work_records"
    ADD CONSTRAINT "internal_work_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."labor_premium_types"
    ADD CONSTRAINT "labor_premium_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_attempts"
    ADD CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_nonces"
    ADD CONSTRAINT "oauth_nonces_pkey" PRIMARY KEY ("nonce_hash");



ALTER TABLE ONLY "public"."organization_member_roles"
    ADD CONSTRAINT "organization_member_roles_pkey" PRIMARY KEY ("organization_id", "user_id", "role_id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_user_id_key" UNIQUE ("organization_id", "user_id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_roles"
    ADD CONSTRAINT "organization_roles_organization_id_name_key" UNIQUE ("organization_id", "name");



ALTER TABLE ONLY "public"."organization_roles"
    ADD CONSTRAINT "organization_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."record_versions"
    ADD CONSTRAINT "record_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."record_versions"
    ADD CONSTRAINT "record_versions_resource_type_resource_id_version_number_key" UNIQUE ("resource_type", "resource_id", "version_number");



ALTER TABLE ONLY "public"."report_actual_staffs"
    ADD CONSTRAINT "report_actual_staffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_actual_staffs"
    ADD CONSTRAINT "report_actual_staffs_report_id_staff_id_key" UNIQUE ("report_id", "staff_id");



ALTER TABLE ONLY "public"."report_images"
    ADD CONSTRAINT "report_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_shifts"
    ADD CONSTRAINT "report_shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_shifts"
    ADD CONSTRAINT "report_shifts_report_id_shift_id_key" UNIQUE ("report_id", "shift_id");



ALTER TABLE ONLY "public"."report_values"
    ADD CONSTRAINT "report_values_pkey" PRIMARY KEY ("report_id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("organization_id", "resource_type");



ALTER TABLE ONLY "public"."security_incidents"
    ADD CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_types"
    ADD CONSTRAINT "service_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_pattern_segment_staffs"
    ADD CONSTRAINT "shift_pattern_segment_staffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_pattern_segments"
    ADD CONSTRAINT "shift_pattern_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_pattern_staffs"
    ADD CONSTRAINT "shift_pattern_staffs_pkey" PRIMARY KEY ("pattern_id", "staff_id");



ALTER TABLE ONLY "public"."shift_patterns"
    ADD CONSTRAINT "shift_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_segment_staffs"
    ADD CONSTRAINT "shift_segment_staffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_segments"
    ADD CONSTRAINT "shift_segments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shift_staffs"
    ADD CONSTRAINT "shift_staffs_pkey" PRIMARY KEY ("shift_id", "staff_id");



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_position_presets"
    ADD CONSTRAINT "staff_position_presets_organization_id_name_key" UNIQUE ("organization_id", "name");



ALTER TABLE ONLY "public"."staff_position_presets"
    ADD CONSTRAINT "staff_position_presets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_roles"
    ADD CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_deletion_requests"
    ADD CONSTRAINT "user_deletion_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_session_activity"
    ADD CONSTRAINT "user_session_activity_pkey" PRIMARY KEY ("session_hash");



ALTER TABLE ONLY "public"."vendor_registry"
    ADD CONSTRAINT "vendor_registry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_registry"
    ADD CONSTRAINT "vendor_registry_vendor_name_key" UNIQUE ("vendor_name");



CREATE UNIQUE INDEX "assignments_client_staff_unique_idx" ON "public"."assignments" USING "btree" ("client_id", "staff_id") WHERE ("staff_id" IS NOT NULL);



CREATE INDEX "assignments_staff_idx" ON "public"."assignments" USING "btree" ("staff_id") WHERE ("staff_id" IS NOT NULL);



CREATE UNIQUE INDEX "audit_events_event_id_key" ON "public"."audit_events" USING "btree" ("event_id");



CREATE INDEX "audit_events_org_created_idx" ON "public"."audit_events" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "audit_events_resource_idx" ON "public"."audit_events" USING "btree" ("resource_type", "resource_id", "created_at" DESC);



CREATE INDEX "audit_events_session_idx" ON "public"."audit_events" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "clients_active_idx" ON "public"."clients" USING "btree" ("organization_id", "name") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_shifts_client" ON "public"."shifts" USING "btree" ("client_id");



CREATE INDEX "idx_shifts_org_date" ON "public"."shifts" USING "btree" ("organization_id", "start_at");



CREATE INDEX "idx_staffs_org" ON "public"."staffs" USING "btree" ("organization_id");



CREATE INDEX "idx_staffs_user" ON "public"."staffs" USING "btree" ("user_id");



CREATE INDEX "internal_work_records_org_start_idx" ON "public"."internal_work_records" USING "btree" ("organization_id", "start_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "internal_work_records_staff_start_idx" ON "public"."internal_work_records" USING "btree" ("staff_id", "start_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "invitations_expiry_idx" ON "public"."invitations" USING "btree" ("expires_at") WHERE ("is_used" = false);



CREATE INDEX "invitations_staff_idx" ON "public"."invitations" USING "btree" ("staff_id") WHERE ("staff_id" IS NOT NULL);



CREATE INDEX "labor_premium_types_organization_id_display_order_idx" ON "public"."labor_premium_types" USING "btree" ("organization_id", "display_order");



CREATE INDEX "login_attempts_email_created_idx" ON "public"."login_attempts" USING "btree" ("email_hash", "created_at" DESC);



CREATE INDEX "login_attempts_ip_created_idx" ON "public"."login_attempts" USING "btree" ("ip_hash", "created_at" DESC);



CREATE INDEX "oauth_nonces_expiry_idx" ON "public"."oauth_nonces" USING "btree" ("expires_at");



CREATE INDEX "organization_member_roles_organization_id_user_id_idx" ON "public"."organization_member_roles" USING "btree" ("organization_id", "user_id");



CREATE INDEX "organization_roles_organization_id_idx" ON "public"."organization_roles" USING "btree" ("organization_id");



CREATE INDEX "report_actual_staffs_report_idx" ON "public"."report_actual_staffs" USING "btree" ("report_id", "sort_order");



CREATE INDEX "report_shifts_report_id_idx" ON "public"."report_shifts" USING "btree" ("report_id");



CREATE INDEX "report_shifts_shift_id_idx" ON "public"."report_shifts" USING "btree" ("shift_id");



CREATE INDEX "reports_active_date_range_idx" ON "public"."reports" USING "btree" ("start_at", "end_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "reports_active_idx" ON "public"."reports" USING "btree" ("client_id", "start_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "reports_active_segment_unique_idx" ON "public"."reports" USING "btree" ("segment_id") WHERE (("segment_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "reports_active_status_idx" ON "public"."reports" USING "btree" ("status", "start_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "reports_actual_service_type_idx" ON "public"."reports" USING "btree" ("actual_service_type_id") WHERE ("actual_service_type_id" IS NOT NULL);



CREATE INDEX "reports_segment_id_idx" ON "public"."reports" USING "btree" ("segment_id") WHERE ("segment_id" IS NOT NULL);



CREATE INDEX "service_types_organization_id_sort_order_idx" ON "public"."service_types" USING "btree" ("organization_id", "sort_order");



CREATE INDEX "shift_pattern_segment_staffs_segment_id_idx" ON "public"."shift_pattern_segment_staffs" USING "btree" ("segment_id");



CREATE INDEX "shift_pattern_segment_staffs_staff_id_idx" ON "public"."shift_pattern_segment_staffs" USING "btree" ("staff_id");



CREATE INDEX "shift_pattern_segments_pattern_id_sort_order_idx" ON "public"."shift_pattern_segments" USING "btree" ("pattern_id", "sort_order");



CREATE INDEX "shift_segment_staffs_segment_id_idx" ON "public"."shift_segment_staffs" USING "btree" ("segment_id");



CREATE INDEX "shift_segments_shift_id_sort_order_idx" ON "public"."shift_segments" USING "btree" ("shift_id", "sort_order");



CREATE INDEX "shifts_active_google_event_id_idx" ON "public"."shifts" USING "btree" ("organization_id", "google_event_id") WHERE (("deleted_at" IS NULL) AND ("google_event_id" IS NOT NULL));



CREATE INDEX "shifts_active_google_sync_status_idx" ON "public"."shifts" USING "btree" ("organization_id", "google_sync_status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "shifts_deleted_pending_google_sync_idx" ON "public"."shifts" USING "btree" ("organization_id", "google_sync_status") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "staff_roles_organization_id_sort_order_idx" ON "public"."staff_roles" USING "btree" ("organization_id", "sort_order");



CREATE INDEX "staffs_active_idx" ON "public"."staffs" USING "btree" ("organization_id", "sort_order", "name") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "staffs_active_user_unique_idx" ON "public"."staffs" USING "btree" ("organization_id", "user_id") WHERE (("user_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE UNIQUE INDEX "user_session_activity_auth_session_key" ON "public"."user_session_activity" USING "btree" ("auth_session_id");



CREATE INDEX "user_session_activity_user_idx" ON "public"."user_session_activity" USING "btree" ("user_id", "last_activity" DESC);



CREATE OR REPLACE TRIGGER "audit_events_chain_insert" BEFORE INSERT ON "public"."audit_events" FOR EACH ROW EXECUTE FUNCTION "private"."chain_audit_event"();



CREATE OR REPLACE TRIGGER "audit_events_no_update" BEFORE DELETE OR UPDATE ON "public"."audit_events" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_event_mutation"();



CREATE OR REPLACE TRIGGER "report_values_capture_version" AFTER INSERT OR UPDATE ON "public"."report_values" FOR EACH ROW EXECUTE FUNCTION "public"."capture_report_values_version"();



CREATE OR REPLACE TRIGGER "reports_capture_version" AFTER INSERT OR UPDATE ON "public"."reports" FOR EACH ROW EXECUTE FUNCTION "public"."capture_report_version"();



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_ghost_staff_id_fkey" FOREIGN KEY ("ghost_staff_id") REFERENCES "public"."staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_helper_id_fkey" FOREIGN KEY ("helper_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey_profiles" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."backup_restore_tests"
    ADD CONSTRAINT "backup_restore_tests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compliance_evidence"
    ADD CONSTRAINT "compliance_evidence_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compliance_risks"
    ADD CONSTRAINT "compliance_risks_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compliance_risks"
    ADD CONSTRAINT "compliance_risks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deletion_requests"
    ADD CONSTRAINT "deletion_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deletion_requests"
    ADD CONSTRAINT "deletion_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."deletion_requests"
    ADD CONSTRAINT "deletion_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_member_roles"
    ADD CONSTRAINT "fk_member" FOREIGN KEY ("organization_id", "user_id") REFERENCES "public"."organization_members"("organization_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staffs"
    ADD CONSTRAINT "ghost_staffs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."internal_work_records"
    ADD CONSTRAINT "internal_work_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."internal_work_records"
    ADD CONSTRAINT "internal_work_records_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."internal_work_records"
    ADD CONSTRAINT "internal_work_records_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staffs"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staffs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."labor_premium_types"
    ADD CONSTRAINT "labor_premium_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_nonces"
    ADD CONSTRAINT "oauth_nonces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_nonces"
    ADD CONSTRAINT "oauth_nonces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_member_roles"
    ADD CONSTRAINT "organization_member_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."organization_roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_roles"
    ADD CONSTRAINT "organization_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_last_organization_id_fkey" FOREIGN KEY ("last_organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."record_versions"
    ADD CONSTRAINT "record_versions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."record_versions"
    ADD CONSTRAINT "record_versions_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."record_versions"
    ADD CONSTRAINT "record_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."report_actual_staffs"
    ADD CONSTRAINT "report_actual_staffs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_actual_staffs"
    ADD CONSTRAINT "report_actual_staffs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_actual_staffs"
    ADD CONSTRAINT "report_actual_staffs_staff_role_id_fkey" FOREIGN KEY ("staff_role_id") REFERENCES "public"."staff_roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."report_images"
    ADD CONSTRAINT "report_images_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_shifts"
    ADD CONSTRAINT "report_shifts_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_shifts"
    ADD CONSTRAINT "report_shifts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_values"
    ADD CONSTRAINT "report_values_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_actual_service_type_id_fkey" FOREIGN KEY ("actual_service_type_id") REFERENCES "public"."service_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_helper_id_fkey" FOREIGN KEY ("helper_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."shift_segments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."security_incidents"
    ADD CONSTRAINT "security_incidents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_types"
    ADD CONSTRAINT "service_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_pattern_segment_staffs"
    ADD CONSTRAINT "shift_pattern_segment_staffs_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."shift_pattern_segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_pattern_segment_staffs"
    ADD CONSTRAINT "shift_pattern_segment_staffs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_pattern_segment_staffs"
    ADD CONSTRAINT "shift_pattern_segment_staffs_staff_role_id_fkey" FOREIGN KEY ("staff_role_id") REFERENCES "public"."staff_roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_pattern_segments"
    ADD CONSTRAINT "shift_pattern_segments_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "public"."shift_patterns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_pattern_segments"
    ADD CONSTRAINT "shift_pattern_segments_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_pattern_staffs"
    ADD CONSTRAINT "shift_pattern_staffs_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "public"."shift_patterns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_pattern_staffs"
    ADD CONSTRAINT "shift_pattern_staffs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_patterns"
    ADD CONSTRAINT "shift_patterns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_patterns"
    ADD CONSTRAINT "shift_patterns_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_patterns"
    ADD CONSTRAINT "shift_patterns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_segment_staffs"
    ADD CONSTRAINT "shift_segment_staffs_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."shift_segments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_segment_staffs"
    ADD CONSTRAINT "shift_segment_staffs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_segment_staffs"
    ADD CONSTRAINT "shift_segment_staffs_staff_role_id_fkey" FOREIGN KEY ("staff_role_id") REFERENCES "public"."staff_roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_segments"
    ADD CONSTRAINT "shift_segments_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shift_segments"
    ADD CONSTRAINT "shift_segments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_staffs"
    ADD CONSTRAINT "shift_staffs_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shift_staffs"
    ADD CONSTRAINT "shift_staffs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staffs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_base_shift_id_fkey" FOREIGN KEY ("base_shift_id") REFERENCES "public"."shifts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shifts"
    ADD CONSTRAINT "shifts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_position_presets"
    ADD CONSTRAINT "staff_position_presets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_roles"
    ADD CONSTRAINT "staff_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staffs"
    ADD CONSTRAINT "staffs_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staffs"
    ADD CONSTRAINT "staffs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_deletion_requests"
    ADD CONSTRAINT "user_deletion_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_deletion_requests"
    ADD CONSTRAINT "user_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_session_activity"
    ADD CONSTRAINT "user_session_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_registry"
    ADD CONSTRAINT "vendor_registry_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



CREATE POLICY "Accessible via report access" ON "public"."report_shifts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."reports" "rep"
  WHERE (("rep"."id" = "report_shifts"."report_id") AND "private"."can_access_client"("rep"."client_id")))));



CREATE POLICY "Admin update invitations" ON "public"."invitations" FOR UPDATE USING ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Admins can delete shifts" ON "public"."shifts" FOR DELETE USING ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Admins can insert shifts" ON "public"."shifts" FOR INSERT WITH CHECK ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Admins can update shifts" ON "public"."shifts" FOR UPDATE USING ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Admins insert members" ON "public"."organization_members" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Allow delete for owners and managers" ON "public"."assignments" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "assignments"."client_id") AND ("clients"."organization_id" IN ( SELECT "organization_members"."organization_id"
           FROM "public"."organization_members"
          WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."role" = 'owner'::"text"))))))));



CREATE POLICY "Allow insert for owners and managers" ON "public"."assignments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "assignments"."client_id") AND ("clients"."organization_id" IN ( SELECT "organization_members"."organization_id"
           FROM "public"."organization_members"
          WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."role" = 'owner'::"text"))))))));



CREATE POLICY "Allow select for organization members" ON "public"."assignments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "assignments"."client_id") AND ("clients"."organization_id" IN ( SELECT "organization_members"."organization_id"
           FROM "public"."organization_members"
          WHERE ("organization_members"."user_id" = "auth"."uid"())))))));



CREATE POLICY "Authenticated read base" ON "public"."assignments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."clients" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."form_templates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."notifications" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."organization_members" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."organizations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."report_images" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."report_values" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."reports" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."shift_pattern_staffs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."shift_patterns" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."shift_staffs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."shifts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated read base" ON "public"."staffs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Create invitations" ON "public"."invitations" FOR INSERT WITH CHECK ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Create orgs" ON "public"."organizations" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Create reports" ON "public"."reports" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "reports"."client_id") AND "public"."is_org_member"("clients"."organization_id")))));



CREATE POLICY "Delete report images" ON "public"."report_images" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."reports" "r"
     JOIN "public"."clients" "c" ON (("r"."client_id" = "c"."id")))
  WHERE (("r"."id" = "report_images"."report_id") AND (("r"."helper_id" = "auth"."uid"()) OR "public"."is_org_admin"("c"."organization_id"))))));



CREATE POLICY "Delete reports" ON "public"."reports" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "reports"."client_id") AND "public"."is_org_admin"("clients"."organization_id")))));



CREATE POLICY "Enable insert for admins" ON "public"."staffs" FOR INSERT WITH CHECK (
  auth.uid() IN (
    SELECT organization_members.user_id
    FROM public.organization_members
    WHERE organization_members.organization_id = staffs.organization_id
      AND organization_members.role = 'owner'::text
  )
);


CREATE POLICY "Enable insert for staff" ON "public"."report_images" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."reports" "r"
     JOIN "public"."clients" "c" ON (("r"."client_id" = "c"."id")))
     JOIN "public"."organization_members" "om" ON (("c"."organization_id" = "om"."organization_id")))
  WHERE (("r"."id" = "report_images"."report_id") AND ("om"."user_id" = "auth"."uid"())))));



CREATE POLICY "Enable read for organization members" ON "public"."report_images" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."reports" "r"
     JOIN "public"."clients" "c" ON (("r"."client_id" = "c"."id")))
     JOIN "public"."organization_members" "om" ON (("c"."organization_id" = "om"."organization_id")))
  WHERE (("r"."id" = "report_images"."report_id") AND ("om"."user_id" = "auth"."uid"())))));



CREATE POLICY "Hide deleted clients" ON "public"."clients" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("deleted_at" IS NULL));



CREATE POLICY "Hide deleted shift patterns" ON "public"."shift_patterns" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("deleted_at" IS NULL));



CREATE POLICY "Hide deleted shifts" ON "public"."shifts" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("deleted_at" IS NULL));



CREATE POLICY "Hide deleted staffs" ON "public"."staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("deleted_at" IS NULL));



CREATE POLICY "Internal work visible to org members" ON "public"."internal_work_records" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "internal_work_records"."organization_id") AND ("om"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Manage clients" ON "public"."clients" USING ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Manage members" ON "public"."organization_members" USING ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Manage own profile" ON "public"."profiles" USING (("auth"."uid"() = "id")) WITH CHECK ((("auth"."uid"() = "id") AND ("role" IS NULL)));



CREATE POLICY "Manage report values" ON "public"."report_values" USING ((EXISTS ( SELECT 1
   FROM ("public"."reports" "r"
     JOIN "public"."clients" "c" ON (("r"."client_id" = "c"."id")))
  WHERE (("r"."id" = "report_values"."report_id") AND (("r"."helper_id" = "auth"."uid"()) OR "public"."is_org_admin"("c"."organization_id"))))));



CREATE POLICY "Manage shift_pattern_staffs" ON "public"."shift_pattern_staffs" USING ((EXISTS ( SELECT 1
   FROM "public"."shift_patterns" "sp"
  WHERE (("sp"."id" = "shift_pattern_staffs"."pattern_id") AND "public"."is_org_admin"("sp"."organization_id")))));



CREATE POLICY "Manage shift_patterns" ON "public"."shift_patterns" USING ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Manage staffs" ON "public"."staffs" USING ("public"."is_org_admin"("organization_id"));



CREATE POLICY "Manage templates" ON "public"."form_templates" USING ((EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "form_templates"."client_id") AND "public"."is_org_admin"("clients"."organization_id")))));



CREATE POLICY "Members read own role links" ON "public"."organization_member_roles" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organization_member_roles"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'owner'::"text"))))));



CREATE POLICY "Org members read premium types" ON "public"."labor_premium_types" FOR SELECT USING ("private"."is_org_member"("organization_id"));



CREATE POLICY "Org members read report actual staffs" ON "public"."report_actual_staffs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."reports" "r"
  WHERE (("r"."id" = "report_actual_staffs"."report_id") AND ("r"."deleted_at" IS NULL) AND "private"."can_access_report"("r"."id")))));



CREATE POLICY "Org members read roles" ON "public"."organization_roles" FOR SELECT USING ("private"."is_org_member"("organization_id"));



CREATE POLICY "Org members read segment staffs" ON "public"."shift_segment_staffs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."shift_segments" "ss"
     JOIN "public"."shifts" "s" ON (("s"."id" = "ss"."shift_id")))
  WHERE (("ss"."id" = "shift_segment_staffs"."segment_id") AND "private"."can_access_shift"("s"."id")))));



CREATE POLICY "Org members read service types" ON "public"."service_types" FOR SELECT USING (("private"."is_org_member"("organization_id") AND ("deleted_at" IS NULL)));



CREATE POLICY "Org members read shift pattern segment staffs" ON "public"."shift_pattern_segment_staffs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."shift_pattern_segments" "sps"
     JOIN "public"."shift_patterns" "sp" ON (("sp"."id" = "sps"."pattern_id")))
  WHERE (("sps"."id" = "shift_pattern_segment_staffs"."segment_id") AND "private"."can_access_shift_pattern"("sp"."id")))));



CREATE POLICY "Org members read shift pattern segments" ON "public"."shift_pattern_segments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."shift_patterns" "sp"
  WHERE (("sp"."id" = "shift_pattern_segments"."pattern_id") AND "private"."can_access_shift_pattern"("sp"."id")))));



CREATE POLICY "Org members read shift segments" ON "public"."shift_segments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."shifts" "s"
  WHERE (("s"."id" = "shift_segments"."shift_id") AND "private"."can_access_shift"("s"."id")))));



CREATE POLICY "Org members read staff position presets" ON "public"."staff_position_presets" FOR SELECT TO "authenticated" USING ("private"."is_org_member"("organization_id"));



CREATE POLICY "Org members read staff roles" ON "public"."staff_roles" FOR SELECT USING (("private"."is_org_member"("organization_id") AND ("deleted_at" IS NULL)));



CREATE POLICY "Own notifications only" ON "public"."notifications" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Profile directory boundary" ON "public"."profiles" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."organization_members" "mine"
     JOIN "public"."organization_members" "theirs" ON (("theirs"."organization_id" = "mine"."organization_id")))
  WHERE (("mine"."user_id" = "auth"."uid"()) AND ("theirs"."user_id" = "profiles"."id"))))));



CREATE POLICY "Read clients" ON "public"."clients" FOR SELECT USING ("public"."is_org_member"("organization_id"));



CREATE POLICY "Read members" ON "public"."organization_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_member"("organization_id")));



CREATE POLICY "Read own orgs" ON "public"."organizations" FOR SELECT USING ("public"."is_org_member"("id"));



CREATE POLICY "Read profiles" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR (("auth"."uid"() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om1"
     JOIN "public"."organization_members" "om2" ON (("om1"."organization_id" = "om2"."organization_id")))
  WHERE (("om1"."user_id" = "auth"."uid"()) AND ("om2"."user_id" = "profiles"."id")))))));



CREATE POLICY "Read report values" ON "public"."report_values" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."reports" "r"
     JOIN "public"."clients" "c" ON (("r"."client_id" = "c"."id")))
  WHERE (("r"."id" = "report_values"."report_id") AND "public"."is_org_member"("c"."organization_id")))));



CREATE POLICY "Read reports" ON "public"."reports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "reports"."client_id") AND "public"."is_org_member"("clients"."organization_id")))));



CREATE POLICY "Read shift_pattern_staffs" ON "public"."shift_pattern_staffs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."shift_patterns" "sp"
  WHERE (("sp"."id" = "shift_pattern_staffs"."pattern_id") AND "public"."is_org_member"("sp"."organization_id")))));



CREATE POLICY "Read shift_patterns" ON "public"."shift_patterns" FOR SELECT USING ("public"."is_org_member"("organization_id"));



CREATE POLICY "Read staffs" ON "public"."staffs" FOR SELECT USING ("public"."is_org_member"("organization_id"));



CREATE POLICY "Read templates" ON "public"."form_templates" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "form_templates"."client_id") AND "public"."is_org_member"("clients"."organization_id")))));



CREATE POLICY "Require active server session" ON "public"."assignments" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."clients" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."form_templates" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."notifications" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."organization_members" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."organizations" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."profiles" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."report_images" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."report_values" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."reports" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."report_actual_staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."shift_pattern_staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."shift_pattern_segment_staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."shift_pattern_segments" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."shift_patterns" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."shift_staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."shift_segment_staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."shift_segments" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."shifts" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Require active server session" ON "public"."staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_session_active"() AS "is_session_active"));



CREATE POLICY "Restrict deleted report visibility" ON "public"."reports" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) OR (EXISTS ( SELECT 1
   FROM ("public"."clients" "c"
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "c"."organization_id")))
  WHERE (("c"."id" = "reports"."client_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'owner'::"text"))))));



CREATE POLICY "Tenant boundary assignments" ON "public"."assignments" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."can_access_client"("assignments"."client_id") AS "can_access_client"));



CREATE POLICY "Tenant boundary clients" ON "public"."clients" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."can_access_client"("clients"."id") AS "can_access_client"));



CREATE POLICY "Tenant boundary form templates" ON "public"."form_templates" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."can_access_client"("form_templates"."client_id") AS "can_access_client"));



CREATE POLICY "Tenant boundary members" ON "public"."organization_members" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_org_member"("organization_members"."organization_id") AS "is_org_member"));



CREATE POLICY "Tenant boundary organizations" ON "public"."organizations" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."is_org_member"("organizations"."id") AS "is_org_member"));



CREATE POLICY "Tenant boundary report images" ON "public"."report_images" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."can_access_report"("report_images"."report_id") AS "can_access_report"));



CREATE POLICY "Tenant boundary report values" ON "public"."report_values" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."can_access_report"("report_values"."report_id") AS "can_access_report"));



CREATE POLICY "Tenant boundary reports" ON "public"."reports" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."can_access_report"("reports"."id") AS "can_access_report"));



CREATE POLICY "Tenant boundary shift pattern staffs" ON "public"."shift_pattern_staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."shift_patterns" "sp"
  WHERE (("sp"."id" = "shift_pattern_staffs"."pattern_id") AND ("sp"."deleted_at" IS NULL) AND "private"."can_access_shift_pattern"("sp"."id")))));



CREATE POLICY "Tenant boundary shift patterns" ON "public"."shift_patterns" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((( SELECT "private"."can_access_shift_pattern"("shift_patterns"."id") AS "can_access_shift_pattern") AND ("deleted_at" IS NULL)));



CREATE POLICY "Tenant boundary shift staffs" ON "public"."shift_staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING (( SELECT "private"."can_access_shift"("shift_staffs"."shift_id") AS "can_access_shift"));



CREATE POLICY "Tenant boundary shifts" ON "public"."shifts" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((( SELECT "private"."can_access_shift"("shifts"."id") AS "can_access_shift") AND ("deleted_at" IS NULL)));



CREATE POLICY "Tenant boundary staffs" ON "public"."staffs" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ((( SELECT "private"."is_org_member"("staffs"."organization_id") AS "is_org_member") AND ("deleted_at" IS NULL)));



CREATE POLICY "Update orgs" ON "public"."organizations" FOR UPDATE USING ("public"."is_org_admin"("id"));



CREATE POLICY "Update reports" ON "public"."reports" FOR UPDATE USING ((("helper_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."clients"
  WHERE (("clients"."id" = "reports"."client_id") AND "public"."is_org_admin"("clients"."organization_id"))))));



CREATE POLICY "Users can delete shift_staffs in their org" ON "public"."shift_staffs" FOR DELETE USING (("shift_id" IN ( SELECT "shifts"."id"
   FROM "public"."shifts"
  WHERE ("shifts"."organization_id" IN ( SELECT "organization_members"."organization_id"
           FROM "public"."organization_members"
          WHERE ("organization_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert shift_staffs in their org" ON "public"."shift_staffs" FOR INSERT WITH CHECK (("shift_id" IN ( SELECT "shifts"."id"
   FROM "public"."shifts"
  WHERE ("shifts"."organization_id" IN ( SELECT "organization_members"."organization_id"
           FROM "public"."organization_members"
          WHERE ("organization_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can verify own session activity" ON "public"."user_session_activity" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND ("auth_session_id" = ( SELECT ("auth"."jwt"() ->> 'session_id'::"text")))));



CREATE POLICY "Users can view shift_staffs in their org" ON "public"."shift_staffs" FOR SELECT USING (("shift_id" IN ( SELECT "shifts"."id"
   FROM "public"."shifts"
  WHERE ("shifts"."organization_id" IN ( SELECT "organization_members"."organization_id"
           FROM "public"."organization_members"
          WHERE ("organization_members"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view shifts in their organization" ON "public"."shifts" FOR SELECT USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "View logs for managers" ON "public"."audit_logs" FOR SELECT USING (
  EXISTS (
    SELECT 1 
    FROM public.organization_members om 
    WHERE om.organization_id = audit_logs.organization_id 
      AND om.user_id = auth.uid() 
      AND om.role = 'owner'::text
  )
);


ALTER TABLE "public"."assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_archive_checkpoints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_restore_tests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compliance_evidence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compliance_risks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deletion_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."internal_work_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."labor_premium_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."oauth_nonces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_member_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."record_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."report_actual_staffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."report_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."report_shifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."report_values" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."retention_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."security_incidents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_pattern_segment_staffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_pattern_segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_pattern_staffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_patterns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_segment_staffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_segments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shift_staffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shifts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_position_presets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staffs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_deletion_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_session_activity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_registry" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "private"."can_access_client"("p_client_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_client"("p_client_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_access_report"("p_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_report"("p_report_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_access_shift"("p_shift_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_shift"("p_shift_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_access_shift_pattern"("p_pattern_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_access_shift_pattern"("p_pattern_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."capture_complete_report_version"("p_report_id" "uuid", "p_actor_id" "uuid", "p_change_reason" "text", "p_session_id" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."chain_audit_event"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."get_actor_staff_id"("p_org_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."get_actor_staff_id"("p_org_id" "uuid", "p_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."get_member_record_action_scope"("p_org_id" "uuid", "p_user_id" "uuid", "p_action" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."get_member_record_view_scope"("p_org_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."get_member_shift_action_scope"("p_org_id" "uuid", "p_user_id" "uuid", "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."get_member_shift_action_scope"("p_org_id" "uuid", "p_user_id" "uuid", "p_action" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_assigned_client_for_user"("p_client_id" "uuid", "p_org_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_assigned_client_for_user"("p_client_id" "uuid", "p_org_id" "uuid", "p_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_org_member"("p_org_id" "uuid", "p_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_org_member"("p_org_id" "uuid", "p_roles" "text"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_session_active"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_session_active"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."accept_invitation_atomic"("p_code" "text", "p_session_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_invitation_atomic"("p_code" "text", "p_session_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_invitation_atomic"("p_code" "text", "p_session_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."capture_report_values_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."capture_report_values_version"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."capture_report_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."capture_report_version"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_organization"("org_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_organization"("org_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_organization"("org_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_org_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_org_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_admin"("_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_admin"("_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_member"("_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_member"("_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_audit_event_mutation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_audit_event_mutation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_report_atomic"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text", "p_actual_service_type_id" "uuid", "p_actual_staffs" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_report_atomic"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text", "p_actual_service_type_id" "uuid", "p_actual_staffs" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_report_atomic"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text", "p_actual_service_type_id" "uuid", "p_actual_staffs" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_report_atomic_v2"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text", "p_actual_service_type_id" "uuid", "p_actual_staffs" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_report_atomic_v2"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text", "p_actual_service_type_id" "uuid", "p_actual_staffs" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_report_atomic_v2"("p_organization_id" "uuid", "p_report_id" "uuid", "p_client_id" "uuid", "p_shift_id" "uuid", "p_segment_id" "uuid", "p_start_at" timestamp with time zone, "p_end_at" timestamp with time zone, "p_status" "text", "p_values" "jsonb", "p_session_id" "text", "p_actual_service_type_id" "uuid", "p_actual_staffs" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."transfer_owner_atomic"("p_org_id" "uuid", "p_new_owner_id" "uuid", "p_current_owner_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_owner_atomic"("p_org_id" "uuid", "p_new_owner_id" "uuid", "p_current_owner_id" "uuid") TO "service_role";


















GRANT SELECT,MAINTAIN ON TABLE "public"."assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."assignments" TO "service_role";



GRANT ALL ON TABLE "public"."audit_archive_checkpoints" TO "service_role";



GRANT ALL ON TABLE "public"."audit_events" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."backup_restore_tests" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."compliance_evidence" TO "service_role";



GRANT ALL ON TABLE "public"."compliance_risks" TO "service_role";



GRANT ALL ON TABLE "public"."deletion_requests" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."form_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."form_templates" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."internal_work_records" TO "authenticated";
GRANT ALL ON TABLE "public"."internal_work_records" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."labor_premium_types" TO "authenticated";
GRANT ALL ON TABLE "public"."labor_premium_types" TO "service_role";



GRANT ALL ON TABLE "public"."login_attempts" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_nonces" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."organization_member_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_member_roles" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."organization_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_roles" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."record_versions" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."report_actual_staffs" TO "authenticated";
GRANT ALL ON TABLE "public"."report_actual_staffs" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."report_images" TO "authenticated";
GRANT ALL ON TABLE "public"."report_images" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."report_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."report_shifts" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."report_values" TO "authenticated";
GRANT ALL ON TABLE "public"."report_values" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT UPDATE("actual_service_type_id") ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."retention_policies" TO "service_role";



GRANT ALL ON TABLE "public"."security_incidents" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."service_types" TO "authenticated";
GRANT ALL ON TABLE "public"."service_types" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."shift_pattern_segment_staffs" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_pattern_segment_staffs" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."shift_pattern_segments" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_pattern_segments" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."shift_pattern_staffs" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_pattern_staffs" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."shift_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_patterns" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."shift_segment_staffs" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_segment_staffs" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."shift_segments" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_segments" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."shift_staffs" TO "authenticated";
GRANT ALL ON TABLE "public"."shift_staffs" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."shifts" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."staff_position_presets" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_position_presets" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."staff_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_roles" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."staffs" TO "authenticated";
GRANT ALL ON TABLE "public"."staffs" TO "service_role";



GRANT ALL ON TABLE "public"."user_deletion_requests" TO "service_role";



GRANT ALL ON TABLE "public"."user_session_activity" TO "service_role";
GRANT SELECT ON TABLE "public"."user_session_activity" TO "authenticated";



GRANT ALL ON TABLE "public"."vendor_registry" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE ALL ON FUNCTIONS FROM PUBLIC;















