ALTER TABLE public.labor_premium_types
  ADD COLUMN IF NOT EXISTS variable_working_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS variable_overtime_period text CHECK (variable_overtime_period IN ('week', 'month')),
  ADD COLUMN IF NOT EXISTS variable_overtime_threshold_hours numeric(6,2);

COMMENT ON COLUMN public.labor_premium_types.variable_working_hours_enabled IS
  '変形労働時間制の時間外閾値を適用するか';
COMMENT ON COLUMN public.labor_premium_types.variable_overtime_period IS
  '変形労働時間制の集計期間。week または month';
COMMENT ON COLUMN public.labor_premium_types.variable_overtime_threshold_hours IS
  '変形労働時間制で割り増し対象となる期間内の超過時間';
