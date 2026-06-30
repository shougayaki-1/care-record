-- Store actual service type and actual staffing on service records.
-- Shift segments remain the planned source of truth.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS actual_service_type_id uuid REFERENCES public.service_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reports_actual_service_type_idx
  ON public.reports (actual_service_type_id)
  WHERE actual_service_type_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.report_actual_staffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES public.staffs(id) ON DELETE CASCADE,
  staff_role_id   uuid REFERENCES public.staff_roles(id) ON DELETE SET NULL,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(report_id, staff_id)
);

CREATE INDEX IF NOT EXISTS report_actual_staffs_report_idx
  ON public.report_actual_staffs (report_id, sort_order);

ALTER TABLE public.report_actual_staffs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.report_actual_staffs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_actual_staffs TO service_role;
GRANT UPDATE (actual_service_type_id) ON public.reports TO service_role;

CREATE POLICY "Org members read report actual staffs" ON public.report_actual_staffs
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = report_id
        AND r.deleted_at IS NULL
        AND private.is_org_member(c.organization_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.report_actual_staffs FROM authenticated;
