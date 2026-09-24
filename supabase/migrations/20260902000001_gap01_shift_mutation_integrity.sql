-- GAP-01: シフト時刻変更・キャンセル切替・単体削除の成功判定をDB実態と一致させる。
--
-- 背景:
--   updateShiftTimeOnly / toggleCancelShift / updateShiftInternal / deleteShiftCompletely は
--   authenticated セッションから直接 UPDATE を発行し、error の有無だけで成功と判定していた。
--   これらのテーブルUPDATE/DELETE RLS（"Admins can update/insert/delete shifts"）は
--   is_org_admin（owner のみ）を要求するため、owner 以外（assigned 権限のスタッフや、
--   カスタムロールで shifts.edit/delete='all' を付与された非owner）が実行すると
--   RLSにより影響行0件のままerrorを返さず、Server Actionは成功として
--   success audit・成功responseへ進んでいた。
--
-- 対応（Option B / GAP-01 承認済み設計）:
--   時刻変更・キャンセル切替・フィールド更新・単体削除を SECURITY DEFINER の
--   atomic RPCへ切り出し、既存の atomic RPC（soft_delete_shifts_atomic 等）と同じ
--   パターンで auth.uid()・session有効性・private.get_member_shift_action_scope(...)='all'
--   （assigned は許可しない）・organization境界を関数内で検証したうえで、
--   GET DIAGNOSTICS ROW_COUNT により実際の変更行数を確認する。
--   0行時は 'not_found' / '(already_)deleted' / 'conflict' を区別して返し、
--   呼び出し元（Server Action）が0行を成功として扱わないようにする。
--   RLSをassigned書き込みへ緩和する変更は行わない。既存の
--   "Admins can update/insert/delete shifts" ポリシー・GRANTは変更しない。

CREATE OR REPLACE FUNCTION public.update_shift_time_atomic(
  p_org_id uuid, p_shift_id uuid, p_start_at timestamptz, p_end_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted_at timestamptz; n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'edit') <> 'all' THEN RAISE EXCEPTION 'shift edit permission required'; END IF;

  SELECT deleted_at INTO v_deleted_at FROM public.shifts WHERE id = p_shift_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_deleted_at IS NOT NULL THEN RETURN 'deleted'; END IF;

  UPDATE public.shifts SET start_at = p_start_at, end_at = p_end_at, updated_at = now(),
    is_modified = true, google_sync_status = 'pending_upsert', google_sync_error = NULL, google_synced_at = NULL
    WHERE id = p_shift_id AND organization_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'updated' ELSE 'conflict' END;
END $$;

CREATE OR REPLACE FUNCTION public.toggle_cancel_shift_atomic(
  p_org_id uuid, p_shift_id uuid, p_is_cancel boolean, p_reason text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted_at timestamptz; n integer; v_status text; v_reason text;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'edit') <> 'all' THEN RAISE EXCEPTION 'shift edit permission required'; END IF;

  SELECT deleted_at INTO v_deleted_at FROM public.shifts WHERE id = p_shift_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_deleted_at IS NOT NULL THEN RETURN 'deleted'; END IF;

  v_status := CASE WHEN p_is_cancel THEN 'cancelled' ELSE 'published' END;
  v_reason := CASE WHEN p_is_cancel THEN p_reason ELSE NULL END;
  UPDATE public.shifts SET status = v_status, cancel_reason = v_reason, updated_at = now(),
    is_modified = true, google_sync_status = 'pending_upsert', google_sync_error = NULL, google_synced_at = NULL
    WHERE id = p_shift_id AND organization_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'updated' ELSE 'conflict' END;
END $$;

CREATE OR REPLACE FUNCTION public.update_shift_fields_atomic(
  p_org_id uuid, p_shift_id uuid, p_payload jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted_at timestamptz; v_client_id uuid; n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'edit') <> 'all' THEN RAISE EXCEPTION 'shift edit permission required'; END IF;

  SELECT deleted_at INTO v_deleted_at FROM public.shifts WHERE id = p_shift_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_deleted_at IS NOT NULL THEN RETURN 'deleted'; END IF;

  IF p_payload ? 'client_id' THEN
    v_client_id := NULLIF(p_payload->>'client_id', '')::uuid;
    IF v_client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.clients c WHERE c.id = v_client_id AND c.organization_id = p_org_id AND c.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'client outside organization'; END IF;
  END IF;

  UPDATE public.shifts SET
    client_id = CASE WHEN p_payload ? 'client_id' THEN NULLIF(p_payload->>'client_id', '')::uuid ELSE client_id END,
    title = CASE WHEN p_payload ? 'title' THEN p_payload->>'title' ELSE title END,
    start_at = CASE WHEN p_payload ? 'start_at' THEN (p_payload->>'start_at')::timestamptz ELSE start_at END,
    end_at = CASE WHEN p_payload ? 'end_at' THEN (p_payload->>'end_at')::timestamptz ELSE end_at END,
    status = CASE WHEN p_payload ? 'status' THEN p_payload->>'status' ELSE status END,
    cancel_reason = CASE WHEN p_payload ? 'cancel_reason' THEN p_payload->>'cancel_reason' ELSE cancel_reason END,
    is_modified = COALESCE((p_payload->>'is_modified')::boolean, true),
    updated_at = now(), google_sync_status = 'pending_upsert', google_sync_error = NULL, google_synced_at = NULL
    WHERE id = p_shift_id AND organization_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'updated' ELSE 'conflict' END;
END $$;

CREATE OR REPLACE FUNCTION public.delete_shift_atomic(
  p_org_id uuid, p_shift_id uuid, p_reason text, p_retention_until timestamptz, p_sync_status text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted_at timestamptz; n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'delete') <> 'all' THEN RAISE EXCEPTION 'shift delete permission required'; END IF;

  SELECT deleted_at INTO v_deleted_at FROM public.shifts WHERE id = p_shift_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_deleted_at IS NOT NULL THEN RETURN 'already_deleted'; END IF;

  UPDATE public.shifts SET deleted_at = now(), deleted_by = auth.uid(), deletion_reason = p_reason,
    retention_until = p_retention_until, google_sync_status = p_sync_status, google_sync_error = NULL,
    google_synced_at = CASE WHEN p_sync_status = 'synced' THEN now() ELSE NULL END
    WHERE id = p_shift_id AND organization_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'deleted' ELSE 'conflict' END;
END $$;

REVOKE ALL ON FUNCTION public.update_shift_time_atomic(uuid,uuid,timestamptz,timestamptz), public.toggle_cancel_shift_atomic(uuid,uuid,boolean,text), public.update_shift_fields_atomic(uuid,uuid,jsonb), public.delete_shift_atomic(uuid,uuid,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_shift_time_atomic(uuid,uuid,timestamptz,timestamptz), public.toggle_cancel_shift_atomic(uuid,uuid,boolean,text), public.update_shift_fields_atomic(uuid,uuid,jsonb), public.delete_shift_atomic(uuid,uuid,text,timestamptz,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
