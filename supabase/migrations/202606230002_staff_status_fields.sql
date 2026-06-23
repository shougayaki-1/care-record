ALTER TABLE public.staffs
  ADD COLUMN IF NOT EXISTS employment_type text,
  ADD COLUMN IF NOT EXISTS work_style text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staffs_employment_type_check'
  ) THEN
    ALTER TABLE public.staffs
      ADD CONSTRAINT staffs_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN ('常勤', '非常勤'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staffs_work_style_check'
  ) THEN
    ALTER TABLE public.staffs
      ADD CONSTRAINT staffs_work_style_check
      CHECK (work_style IS NULL OR work_style IN ('兼務', '専従'));
  END IF;
END $$;
