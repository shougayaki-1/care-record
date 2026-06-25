CREATE TABLE public.report_shifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  shift_id    uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, shift_id)
);
CREATE INDEX ON public.report_shifts (report_id);
CREATE INDEX ON public.report_shifts (shift_id);

-- Migrate existing reports.shift_id → report_shifts (primary links)
INSERT INTO public.report_shifts (report_id, shift_id, is_primary)
SELECT r.id, r.shift_id, true
FROM public.reports r
WHERE r.shift_id IS NOT NULL
  AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = r.shift_id AND s.deleted_at IS NULL)
ON CONFLICT DO NOTHING;

ALTER TABLE public.report_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Accessible via report access" ON public.report_shifts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reports rep WHERE rep.id = report_shifts.report_id AND private.can_access_client(rep.client_id)));
REVOKE INSERT, UPDATE, DELETE ON public.report_shifts FROM authenticated;
