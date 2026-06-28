## Status: DONE

## Commits: aa99f5b

## Tests: npx tsc --noEmit — 0 errors

## Changes
- Created `supabase/migrations/202606280010_segment_only_staffing.sql` (262 lines)
- Drops and recreates `public.save_report_atomic` with OR conditions checking both `shift_staffs` (legacy) and `shift_segment_staffs` (new) in the `assigned` scope access checks for create, edit, and approve paths
- Also extends the auto shift resolution block to check both tables

## Concerns: none — purely additive OR condition; `npx supabase db push` must be run manually to apply to remote DB
