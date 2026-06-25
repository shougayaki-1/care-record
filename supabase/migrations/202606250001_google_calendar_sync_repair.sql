-- Googleカレンダー同期を再開可能・冪等にするための状態列。
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS google_sync_status text,
  ADD COLUMN IF NOT EXISTS google_sync_error text,
  ADD COLUMN IF NOT EXISTS google_synced_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shifts_google_sync_status_check'
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT shifts_google_sync_status_check
      CHECK (google_sync_status IS NULL OR google_sync_status IN ('synced', 'pending_upsert', 'pending_delete', 'failed'));
  END IF;
END $$;

UPDATE public.shifts
   SET google_sync_status = CASE
       WHEN deleted_at IS NOT NULL THEN 'pending_delete'
       WHEN google_event_id IS NULL THEN 'pending_upsert'
       ELSE 'synced'
     END,
     google_sync_error = NULL,
     google_synced_at = CASE
       WHEN deleted_at IS NULL AND google_event_id IS NOT NULL THEN COALESCE(google_synced_at, updated_at, now())
       ELSE google_synced_at
     END
 WHERE google_sync_status IS NULL;

ALTER TABLE public.shifts
  ALTER COLUMN google_sync_status SET DEFAULT 'pending_upsert';

CREATE INDEX IF NOT EXISTS shifts_active_google_sync_status_idx
  ON public.shifts (organization_id, google_sync_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS shifts_active_google_event_id_idx
  ON public.shifts (organization_id, google_event_id)
  WHERE deleted_at IS NULL AND google_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS shifts_deleted_pending_google_sync_idx
  ON public.shifts (organization_id, google_sync_status)
  WHERE deleted_at IS NOT NULL;
