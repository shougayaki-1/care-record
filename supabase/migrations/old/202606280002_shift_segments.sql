-- シフト内のサービス区間（任意で事前設定可能）
CREATE TABLE public.shift_segments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id         uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  service_type_id  uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
  start_at         timestamptz NOT NULL,
  end_at           timestamptz NOT NULL,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.shift_segments (shift_id, sort_order);

ALTER TABLE public.shift_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read shift segments" ON public.shift_segments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id
        AND private.is_org_member(s.organization_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.shift_segments FROM authenticated;

-- 区間ごとのスタッフ割当と役割
CREATE TABLE public.shift_segment_staffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id      uuid NOT NULL REFERENCES public.shift_segments(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES public.staffs(id) ON DELETE CASCADE,
  staff_role_id   uuid REFERENCES public.staff_roles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.shift_segment_staffs (segment_id);

ALTER TABLE public.shift_segment_staffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read segment staffs" ON public.shift_segment_staffs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shift_segments ss
      JOIN public.shifts s ON s.id = ss.shift_id
      WHERE ss.id = segment_id
        AND private.is_org_member(s.organization_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.shift_segment_staffs FROM authenticated;

-- reportsテーブルにsegment_idを追加（後方互換のためNULL許可）
ALTER TABLE public.reports ADD COLUMN segment_id uuid REFERENCES public.shift_segments(id) ON DELETE SET NULL;

CREATE INDEX ON public.reports (segment_id) WHERE segment_id IS NOT NULL;
