-- INSERT ... RETURNING が RLS で必ず失敗する問題の修正。
--
-- 背景:
--   クライアント/シフトの SELECT 系 RESTRICTIVE ポリシーは
--   private.can_access_client(id) / private.can_access_shift(id) を使うが、
--   これらは STABLE 関数内で対象テーブル自身を再検索する。
--   PostgreSQL では同一文が挿入した行はその文のスナップショットから見えないため、
--   authenticated セッションによる INSERT ... RETURNING（supabase-js の
--   .insert().select()）は「行が見つからない → false」となり、
--   "new row violates row-level security policy" で常に失敗していた。
--   （20260716000008 で clients/staffs の書き込みを service role から
--   セッション JWT に移行したことで顕在化）
--
-- 対応:
--   判定に必要な列（organization_id / client_id / deleted_at）は行自身が
--   持っているため、それらを引数で受け取る *_row 関数を追加し、
--   clients / shifts 自身のポリシーは行の列を直接渡して評価する。
--   既存の id 引数版は *_row への委譲に書き換え、他テーブル
--   （assignments / form_templates / shift_staffs 等）のポリシーは
--   従来どおり id 引数版を使い続ける（挿入対象と別テーブルの検索は
--   スナップショット問題の影響を受けない）。
--   アクセス判定ロジック自体は一切変更しない（権限は同一の条件で評価）。

-- ============================================================
-- clients
-- ============================================================

CREATE OR REPLACE FUNCTION "private"."can_access_client_row"(
  "p_client_id" "uuid",
  "p_organization_id" "uuid",
  "p_deleted_at" timestamp with time zone
) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT p_deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = p_organization_id
        AND om.user_id = auth.uid()
    )
    AND (
      private.get_member_record_view_scope(p_organization_id, auth.uid()) = 'all'
      OR private.has_management_permission(p_organization_id, auth.uid(), 'clients')
      OR private.has_management_permission(p_organization_id, auth.uid(), 'reports')
      OR (
        private.get_member_record_view_scope(p_organization_id, auth.uid()) = 'assigned'
        AND private.is_assigned_client_for_user(p_client_id, p_organization_id, auth.uid())
      )
    );
$$;

ALTER FUNCTION "private"."can_access_client_row"("uuid", "uuid", timestamp with time zone) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."can_access_client_row"("uuid", "uuid", timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "private"."can_access_client_row"("uuid", "uuid", timestamp with time zone) TO "authenticated";

-- id 引数版は行カラム版へ委譲（他テーブルのポリシーから従来どおり利用）
CREATE OR REPLACE FUNCTION "private"."can_access_client"("p_client_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE((
    SELECT private.can_access_client_row(c.id, c.organization_id, c.deleted_at)
    FROM public.clients c
    WHERE c.id = p_client_id
  ), false);
$$;

DROP POLICY IF EXISTS "Tenant boundary clients" ON "public"."clients";
CREATE POLICY "Tenant boundary clients" ON "public"."clients"
  AS RESTRICTIVE FOR SELECT TO "authenticated"
  USING (private.can_access_client_row(id, organization_id, deleted_at));

DROP POLICY IF EXISTS "Client select organization boundary" ON "public"."clients";
CREATE POLICY "Client select organization boundary" ON "public"."clients"
  AS RESTRICTIVE FOR SELECT TO "authenticated"
  USING (private.can_access_client_row(id, organization_id, deleted_at));

-- ============================================================
-- shifts
-- ============================================================

CREATE OR REPLACE FUNCTION "private"."can_access_shift_row"(
  "p_shift_id" "uuid",
  "p_organization_id" "uuid",
  "p_client_id" "uuid",
  "p_deleted_at" timestamp with time zone
) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT p_deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = p_organization_id
        AND om.user_id = auth.uid()
    )
    AND (
      private.get_member_shift_action_scope(p_organization_id, auth.uid(), 'view') = 'all'
      OR (
        private.get_member_shift_action_scope(p_organization_id, auth.uid(), 'view') = 'assigned'
        AND (
          private.is_assigned_client_for_user(p_client_id, p_organization_id, auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.shift_staffs ss
            WHERE ss.shift_id = p_shift_id
              AND ss.staff_id = private.get_actor_staff_id(p_organization_id, auth.uid())
          )
          OR EXISTS (
            SELECT 1
            FROM public.shift_segments seg
            JOIN public.shift_segment_staffs sss ON sss.segment_id = seg.id
            WHERE seg.shift_id = p_shift_id
              AND sss.staff_id = private.get_actor_staff_id(p_organization_id, auth.uid())
          )
        )
      )
    );
$$;

ALTER FUNCTION "private"."can_access_shift_row"("uuid", "uuid", "uuid", timestamp with time zone) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."can_access_shift_row"("uuid", "uuid", "uuid", timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "private"."can_access_shift_row"("uuid", "uuid", "uuid", timestamp with time zone) TO "authenticated";

CREATE OR REPLACE FUNCTION "private"."can_access_shift"("p_shift_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE((
    SELECT private.can_access_shift_row(s.id, s.organization_id, s.client_id, s.deleted_at)
    FROM public.shifts s
    WHERE s.id = p_shift_id
  ), false);
$$;

DROP POLICY IF EXISTS "Tenant boundary shifts" ON "public"."shifts";
CREATE POLICY "Tenant boundary shifts" ON "public"."shifts"
  AS RESTRICTIVE FOR SELECT TO "authenticated"
  USING (private.can_access_shift_row(id, organization_id, client_id, deleted_at) AND deleted_at IS NULL);
