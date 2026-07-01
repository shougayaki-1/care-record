-- ひな形内のサービス区間。月次展開時に shift_segments へコピーする。
CREATE TABLE public.shift_pattern_segments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id       uuid NOT NULL REFERENCES public.shift_patterns(id) ON DELETE CASCADE,
  service_type_id  uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
  start_time       time NOT NULL,
  end_time         time NOT NULL,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.shift_pattern_segments (pattern_id, sort_order);

ALTER TABLE public.shift_pattern_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read shift pattern segments" ON public.shift_pattern_segments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shift_patterns sp
      WHERE sp.id = pattern_id
        AND private.is_org_member(sp.organization_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.shift_pattern_segments FROM authenticated;

-- ひな形区間ごとのスタッフ割当と役割。
CREATE TABLE public.shift_pattern_segment_staffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id      uuid NOT NULL REFERENCES public.shift_pattern_segments(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES public.staffs(id) ON DELETE CASCADE,
  staff_role_id   uuid REFERENCES public.staff_roles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.shift_pattern_segment_staffs (segment_id);
CREATE INDEX ON public.shift_pattern_segment_staffs (staff_id);

ALTER TABLE public.shift_pattern_segment_staffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read shift pattern segment staffs" ON public.shift_pattern_segment_staffs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shift_pattern_segments sps
      JOIN public.shift_patterns sp ON sp.id = sps.pattern_id
      WHERE sps.id = segment_id
        AND private.is_org_member(sp.organization_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.shift_pattern_segment_staffs FROM authenticated;

-- 既存ひな形を後方互換の1区間に補完する。
WITH inserted_pattern_segments AS (
  INSERT INTO public.shift_pattern_segments (
    pattern_id,
    service_type_id,
    start_time,
    end_time,
    sort_order
  )
  SELECT
    sp.id,
    NULL,
    sp.start_time,
    sp.end_time,
    0
  FROM public.shift_patterns sp
  WHERE sp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.shift_pattern_segments sps
      WHERE sps.pattern_id = sp.id
    )
  RETURNING id, pattern_id
)
INSERT INTO public.shift_pattern_segment_staffs (
  segment_id,
  staff_id,
  staff_role_id
)
SELECT
  ips.id,
  sps.staff_id,
  NULL
FROM inserted_pattern_segments ips
JOIN public.shift_pattern_staffs sps ON sps.pattern_id = ips.pattern_id;

-- 既存実シフトも後方互換の1区間に補完する。
WITH inserted_shift_segments AS (
  INSERT INTO public.shift_segments (
    shift_id,
    service_type_id,
    start_at,
    end_at,
    sort_order
  )
  SELECT
    s.id,
    NULL,
    s.start_at,
    s.end_at,
    0
  FROM public.shifts s
  WHERE s.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.shift_segments ss
      WHERE ss.shift_id = s.id
    )
  RETURNING id, shift_id
)
INSERT INTO public.shift_segment_staffs (
  segment_id,
  staff_id,
  staff_role_id
)
SELECT
  iss.id,
  ss.staff_id,
  NULL
FROM inserted_shift_segments iss
JOIN public.shift_staffs ss ON ss.shift_id = iss.shift_id;
