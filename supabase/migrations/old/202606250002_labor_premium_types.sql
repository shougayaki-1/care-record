CREATE TABLE public.labor_premium_types (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                              text NOT NULL,
  display_order                     int NOT NULL DEFAULT 0,
  is_enabled                        boolean NOT NULL DEFAULT true,
  rate                              numeric(5,4) NOT NULL,
  calc_method                       text NOT NULL CHECK (calc_method IN ('additive', 'multiplicative')),
  builtin_type                      text CHECK (builtin_type IN ('night', 'overtime', 'custom')),
  night_start_hour                  smallint CHECK (night_start_hour BETWEEN 0 AND 23),
  night_end_hour                    smallint CHECK (night_end_hour BETWEEN 0 AND 23),
  overtime_daily_threshold_hours    numeric(4,2),
  overtime_weekly_threshold_hours   numeric(4,2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.labor_premium_types (organization_id, display_order);

-- Seed defaults for existing orgs
INSERT INTO public.labor_premium_types (organization_id, name, display_order, rate, calc_method, builtin_type, night_start_hour, night_end_hour)
SELECT id, '深夜割り増し', 0, 0.25, 'additive', 'night', 22, 5 FROM public.organizations;

INSERT INTO public.labor_premium_types (organization_id, name, display_order, rate, calc_method, builtin_type, overtime_daily_threshold_hours, overtime_weekly_threshold_hours)
SELECT id, '時間外割り増し', 1, 0.25, 'multiplicative', 'overtime', 8.0, 40.0 FROM public.organizations;

ALTER TABLE public.labor_premium_types ENABLE ROW LEVEL SECURITY;

-- is_org_member function exists in private schema
CREATE POLICY "Org members read premium types" ON public.labor_premium_types FOR SELECT USING (private.is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE ON public.labor_premium_types FROM authenticated;
