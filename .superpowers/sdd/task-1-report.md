## Status: DONE

## Commits: 8dd5e47

## Tests: npm run typecheck (tsc --noEmit) — 0 errors

## Changes
- `src/app/actions/shift.ts`: Added `report_shifts (shift_id, is_primary, reports (id, status, deleted_at))` to SELECT in `getShifts()`; replaced `await attachReportStatuses(data ?? [])` with synchronous inline mapping; removed `attachReportStatuses()` function (23 lines deleted)
- Net diff: 1 file changed, 13 insertions(+), 25 deletions(-)

## Self-review: none
