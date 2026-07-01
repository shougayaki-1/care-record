-- 利用者の担当スタッフ設定を、旧 profiles / ghost_staffs ではなく staffs 台帳に統一する。
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staffs(id) ON DELETE CASCADE;

-- アカウントありの既存割り当ては、staffs.user_id から安全に引き継ぐ。
UPDATE public.assignments AS assignment
SET staff_id = staff.id
FROM public.staffs AS staff
WHERE assignment.staff_id IS NULL
  AND assignment.helper_id IS NOT NULL
  AND staff.user_id = assignment.helper_id;

CREATE UNIQUE INDEX IF NOT EXISTS assignments_client_staff_unique_idx
  ON public.assignments (client_id, staff_id)
  WHERE staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assignments_staff_idx
  ON public.assignments (staff_id)
  WHERE staff_id IS NOT NULL;
