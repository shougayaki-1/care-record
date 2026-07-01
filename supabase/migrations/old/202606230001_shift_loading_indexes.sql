-- シフト管理画面の期間検索、担当者絞り込み、未同期件数取得を高速化する。
CREATE INDEX IF NOT EXISTS shifts_active_org_start_idx
  ON public.shifts (organization_id, start_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shifts_unsynced_active_org_idx
  ON public.shifts (organization_id)
  WHERE deleted_at IS NULL AND google_event_id IS NULL;

CREATE INDEX IF NOT EXISTS shift_staffs_staff_shift_idx
  ON public.shift_staffs (staff_id, shift_id);

CREATE INDEX IF NOT EXISTS shift_staffs_shift_idx
  ON public.shift_staffs (shift_id);

CREATE INDEX IF NOT EXISTS shift_patterns_active_org_idx
  ON public.shift_patterns (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shift_pattern_staffs_pattern_idx
  ON public.shift_pattern_staffs (pattern_id);
