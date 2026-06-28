-- Accelerate reports date range and organization filtering via clients join
CREATE INDEX IF NOT EXISTS reports_active_date_range_idx
  ON public.reports (start_at, end_at)
  WHERE deleted_at IS NULL;

-- Accelerate status filtering combined with date ordering
CREATE INDEX IF NOT EXISTS reports_active_status_idx
  ON public.reports (status, start_at)
  WHERE deleted_at IS NULL;

