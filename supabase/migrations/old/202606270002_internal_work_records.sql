CREATE TABLE public.internal_work_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES public.staffs(id) ON DELETE RESTRICT,
  recorded_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  title           text NOT NULL,
  work_type       text NOT NULL DEFAULT 'meeting',
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  work_hours      numeric(8,2) NOT NULL CHECK (work_hours > 0),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'remanded')),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX internal_work_records_org_start_idx
  ON public.internal_work_records (organization_id, start_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX internal_work_records_staff_start_idx
  ON public.internal_work_records (staff_id, start_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.internal_work_records ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.internal_work_records FROM authenticated;

CREATE POLICY "Internal work visible to org members"
  ON public.internal_work_records FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = internal_work_records.organization_id
        AND om.user_id = auth.uid()
    )
  );
