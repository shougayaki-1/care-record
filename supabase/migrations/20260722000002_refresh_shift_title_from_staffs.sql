-- Keep the denormalized calendar title in sync with the actual segment staff.
-- shift_staffs is refreshed from shift_segment_staffs by existing triggers.
CREATE OR REPLACE FUNCTION public.refresh_shift_title(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client_name text;
  v_staff_names text;
BEGIN
  SELECT
    c.name,
    string_agg(DISTINCT st.name, ', ' ORDER BY st.name)
  INTO v_client_name, v_staff_names
  FROM public.shifts s
  JOIN public.clients c ON c.id = s.client_id
  LEFT JOIN public.shift_staffs ss ON ss.shift_id = s.id
  LEFT JOIN public.staffs st ON st.id = ss.staff_id AND st.deleted_at IS NULL
  WHERE s.id = p_shift_id
  GROUP BY c.name;

  IF v_client_name IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.shifts
  SET title = v_client_name || CASE
    WHEN COALESCE(v_staff_names, '') = '' THEN ''
    ELSE ' (' || v_staff_names || ')'
  END
  WHERE id = p_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_shift_title_from_staff_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_shift_title(OLD.shift_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_shift_title(NEW.shift_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_shift_title_after_staffs ON public.shift_staffs;
CREATE TRIGGER refresh_shift_title_after_staffs
AFTER INSERT OR UPDATE OR DELETE ON public.shift_staffs
FOR EACH ROW EXECUTE FUNCTION public.refresh_shift_title_from_staff_trigger();

-- Repair already-affected active shifts and queue them for calendar synchronization.
UPDATE public.shifts s
SET
  title = c.name || CASE
    WHEN COALESCE(staff_names.names, '') = '' THEN ''
    ELSE ' (' || staff_names.names || ')'
  END,
  google_sync_status = 'pending_upsert',
  google_sync_error = NULL,
  google_synced_at = NULL,
  updated_at = now()
FROM public.clients c
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT st.name, ', ' ORDER BY st.name) AS names
  FROM public.shift_staffs ss
  JOIN public.staffs st ON st.id = ss.staff_id AND st.deleted_at IS NULL
  WHERE ss.shift_id = s.id
) staff_names ON true
WHERE s.client_id = c.id
  AND s.deleted_at IS NULL
  AND s.title IS DISTINCT FROM c.name || CASE
    WHEN COALESCE(staff_names.names, '') = '' THEN ''
    ELSE ' (' || staff_names.names || ')'
  END;

REVOKE ALL ON FUNCTION public.refresh_shift_title(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_shift_title_from_staff_trigger() FROM PUBLIC;
