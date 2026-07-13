-- Foundation for shift staffing, Google sync recovery, and private report autosaves.
-- All changes are additive so application code can be deployed before data repair runs.

ALTER TABLE public.shift_patterns
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_until date,
  ADD COLUMN IF NOT EXISTS supersedes_pattern_id uuid REFERENCES public.shift_patterns(id) ON DELETE SET NULL;

ALTER TABLE public.shift_segments
  ADD COLUMN IF NOT EXISTS source_pattern_segment_id uuid REFERENCES public.shift_pattern_segments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shift_segments_source_pattern_segment_unique_idx
  ON public.shift_segments (shift_id, source_pattern_segment_id)
  WHERE source_pattern_segment_id IS NOT NULL;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS google_connection_status text NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS google_connection_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_connection_error_code text;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_google_connection_status_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_google_connection_status_check
  CHECK (google_connection_status IN ('disconnected', 'healthy', 'reauth_required', 'calendar_missing', 'forbidden', 'misconfigured', 'temporarily_unavailable'));

ALTER TABLE public.oauth_nonces
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'connect';

ALTER TABLE public.oauth_nonces
  DROP CONSTRAINT IF EXISTS oauth_nonces_mode_check;
ALTER TABLE public.oauth_nonces
  ADD CONSTRAINT oauth_nonces_mode_check CHECK (mode IN ('connect', 'reauthorize'));

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS content_revision bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.report_autosaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_key uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.reports(id) ON DELETE CASCADE,
  editor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_content_revision bigint,
  autosave_revision bigint NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS report_autosaves_editor_report_idx
  ON public.report_autosaves (editor_user_id, report_id)
  WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS report_autosaves_expiry_idx ON public.report_autosaves (expires_at);
ALTER TABLE public.report_autosaves ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.google_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'failed')),
  phase text NOT NULL DEFAULT 'shifts' CHECK (phase IN ('shifts', 'remote_scan')),
  cursor text,
  processed_count integer NOT NULL DEFAULT 0,
  succeeded_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.google_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.maintenance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  target_month text,
  status text NOT NULL CHECK (status IN ('preview', 'applied', 'rolled_back', 'failed')),
  requested_by uuid REFERENCES auth.users(id),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.maintenance_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.maintenance_runs(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  action text NOT NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_hash text,
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'applied', 'skipped', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_run_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS report_actual_staffs_staff_report_idx
  ON public.report_actual_staffs (staff_id, report_id);

-- Upgrade only the standard numeric urine-disposal item. Custom text fields
-- and renamed fields are deliberately left untouched.
UPDATE public.form_templates ft
SET schema = (
  SELECT jsonb_agg(
    CASE
      WHEN item->>'id' = 'urine_disposal' AND item->>'type' = 'number'
        THEN item || jsonb_build_object('hasDetail', true, 'detailMode', 'always', 'detailLabel', '補足（色・状態など）')
      ELSE item
    END
  )
  FROM jsonb_array_elements(ft.schema) AS item
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(ft.schema) AS item
  WHERE item->>'id' = 'urine_disposal' AND item->>'type' = 'number'
);

CREATE OR REPLACE FUNCTION public.refresh_shift_staffs(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.shift_staffs WHERE shift_id = p_shift_id;
  INSERT INTO public.shift_staffs (shift_id, staff_id)
  SELECT p_shift_id, source.staff_id
  FROM (
    SELECT DISTINCT sss.staff_id
    FROM public.shift_segments ss
    JOIN public.shift_segment_staffs sss ON sss.segment_id = ss.id
    WHERE ss.shift_id = p_shift_id
  ) AS source;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_shift_staffs_from_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_shift_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'shift_segments' THEN
    IF TG_OP = 'DELETE' THEN
      target_shift_id := OLD.shift_id;
    ELSE
      target_shift_id := NEW.shift_id;
    END IF;
  ELSE
    SELECT shift_id INTO target_shift_id
    FROM public.shift_segments
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.segment_id ELSE NEW.segment_id END;
  END IF;
  IF target_shift_id IS NOT NULL THEN
    PERFORM public.refresh_shift_staffs(target_shift_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_shift_staffs_after_segments ON public.shift_segments;
CREATE TRIGGER refresh_shift_staffs_after_segments
AFTER INSERT OR UPDATE OR DELETE ON public.shift_segments
FOR EACH ROW EXECUTE FUNCTION public.refresh_shift_staffs_from_trigger();

DROP TRIGGER IF EXISTS refresh_shift_staffs_after_segment_staffs ON public.shift_segment_staffs;
CREATE TRIGGER refresh_shift_staffs_after_segment_staffs
AFTER INSERT OR UPDATE OR DELETE ON public.shift_segment_staffs
FOR EACH ROW EXECUTE FUNCTION public.refresh_shift_staffs_from_trigger();

NOTIFY pgrst, 'reload schema';
