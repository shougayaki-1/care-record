-- 方針S: 「シフトに入っているスタッフは記録を読み書きできる」権限拡張
--
-- 変更点1: can_access_client — assignments OR shift_staffs の OR 条件に拡張
-- 変更点2: save_report_atomic — 新規作成・編集両方で同じ OR 条件に拡張

-- ──────────────────────────────────────────────────────────────────────────
-- 1. can_access_client の更新
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.can_access_client(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
STABLE
AS $$
  WITH
    client_org AS (
      SELECT c.organization_id
      FROM public.clients c
      WHERE c.id = p_client_id
        AND c.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.organization_id = c.organization_id
            AND om.user_id = auth.uid()
        )
    ),
    scope AS (
      SELECT
        private.get_member_record_view_scope(co.organization_id, auth.uid()) AS s,
        co.organization_id
      FROM client_org co
    )
  SELECT EXISTS (
    SELECT 1 FROM scope
    WHERE scope.s = 'all'
      OR (
        scope.s = 'assigned'
        AND (
          -- 従来条件: assignments テーブルに登録済み（helper_id or staff_id）
          private.is_assigned_client_for_user(p_client_id, scope.organization_id, auth.uid())
          -- 追加条件: 当該利用者の shift_staffs に自分の staff_id が入っている
          OR EXISTS (
            SELECT 1
            FROM public.shifts s
            JOIN public.shift_staffs ss ON ss.shift_id = s.id
            WHERE s.client_id = p_client_id
              AND s.organization_id = scope.organization_id
              AND s.deleted_at IS NULL
              AND ss.staff_id = private.get_actor_staff_id(scope.organization_id, auth.uid())
          )
        )
      )
  )
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. save_report_atomic の更新
--    変更箇所: 新規作成時の access_denied チェック（1 箇所）
--             編集時の access_denied チェック（1 箇所）
--    それ以外のロジックは 202606270004 から変更なし
-- ──────────────────────────────────────────────────────────────────────────
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
  target uuid := p_report_id;
  previous_status text;
  existing_helper uuid;
  existing_shift_id uuid;
  effective_shift_id uuid := p_shift_id;
  actor_staff_id uuid;
  create_scope text;
  edit_scope text;
  approve_scope text;
  required_scope text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_end_at <= p_start_at THEN RAISE EXCEPTION 'invalid_period'; END IF;
  IF p_status NOT IN ('draft', 'pending', 'approved', 'remanded') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF octet_length(p_values::text) > 1000000 THEN RAISE EXCEPTION 'values_too_large'; END IF;

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

  PERFORM set_config('care_record.skip_version', 'on', true);
  IF target IS NULL THEN
    -- ── 新規作成パス ────────────────────────────────────────────────────
    IF p_status IN ('approved', 'remanded') THEN RAISE EXCEPTION 'invalid_initial_status'; END IF;
    required_scope := create_scope;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;

    -- 権限チェック: assignments に登録済み OR 当該利用者のシフト（shift_staffs）に自分が入っている
    IF required_scope = 'assigned'
       AND NOT EXISTS (
         SELECT 1 FROM public.assignments a
          WHERE a.client_id = p_client_id
            AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
       )
       AND NOT (
         actor_staff_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.shifts s
           JOIN public.shift_staffs ss ON ss.shift_id = s.id
            WHERE s.client_id = p_client_id
              AND s.organization_id = p_organization_id
              AND s.deleted_at IS NULL
              AND ss.staff_id = actor_staff_id
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
         AND EXISTS (
           SELECT 1 FROM public.shift_staffs ss
            WHERE ss.shift_id = s.id
              AND ss.staff_id = actor_staff_id
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
      SELECT CASE WHEN count(*) = 1 THEN min(id) ELSE NULL END
        INTO effective_shift_id
        FROM candidates;
    END IF;

    INSERT INTO public.reports(client_id, helper_id, start_at, end_at, status, shift_id, updated_at)
    VALUES (p_client_id, actor, p_start_at, p_end_at, p_status, effective_shift_id, now()) RETURNING id INTO target;
    INSERT INTO public.report_values(report_id, data) VALUES(target, p_values);
  ELSE
    -- ── 編集パス ────────────────────────────────────────────────────────
    SELECT r.status, r.helper_id, r.shift_id INTO previous_status, existing_helper, existing_shift_id
      FROM public.reports r JOIN public.clients c ON c.id = r.client_id
     WHERE r.id = target AND r.client_id = p_client_id AND c.organization_id = p_organization_id
       AND r.deleted_at IS NULL FOR UPDATE;
    IF previous_status IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;
    IF previous_status = 'approved' AND p_status <> 'remanded' THEN RAISE EXCEPTION 'approved_report_locked'; END IF;

    required_scope := CASE WHEN p_status IN ('approved', 'remanded') THEN approve_scope ELSE edit_scope END;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;

    -- 権限チェック: 自分が作成者 OR assignments に登録済み OR シフト（shift_staffs）に自分が入っている
    IF required_scope = 'assigned'
       AND existing_helper IS DISTINCT FROM actor
       AND NOT EXISTS (
         SELECT 1 FROM public.assignments a
          WHERE a.client_id = p_client_id
            AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
       )
       AND NOT (
         actor_staff_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.shifts s
           JOIN public.shift_staffs ss ON ss.shift_id = s.id
            WHERE s.client_id = p_client_id
              AND s.organization_id = p_organization_id
              AND s.deleted_at IS NULL
              AND ss.staff_id = actor_staff_id
         )
       )
    THEN RAISE EXCEPTION 'access_denied'; END IF;

    effective_shift_id := COALESCE(p_shift_id, existing_shift_id);
    IF effective_shift_id IS NULL THEN
      SELECT rs.shift_id INTO effective_shift_id
        FROM public.report_shifts rs
       WHERE rs.report_id = target
         AND rs.is_primary = true
       ORDER BY rs.created_at
       LIMIT 1;
    END IF;

    UPDATE public.reports SET start_at=p_start_at, end_at=p_end_at, status=p_status,
      shift_id=effective_shift_id, updated_at=now(),
      approved_by=CASE WHEN p_status='approved' THEN actor WHEN p_status='remanded' THEN NULL ELSE approved_by END,
      approved_at=CASE WHEN p_status='approved' THEN now() WHEN p_status='remanded' THEN NULL ELSE approved_at END
     WHERE id=target;
    IF EXISTS (SELECT 1 FROM public.report_values rv WHERE rv.report_id=target) THEN
      UPDATE public.report_values SET data=p_values WHERE report_id=target;
    ELSE
      INSERT INTO public.report_values(report_id,data) VALUES(target,p_values);
    END IF;
  END IF;

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
    'report',target::text,'success',p_session_id,jsonb_build_object('previousStatus',previous_status,'newStatus',p_status,'shiftId',effective_shift_id));
  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) TO authenticated;
