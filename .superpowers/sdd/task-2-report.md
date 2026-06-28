## Status: DONE

## Commit: 5f5888c

## Typecheck: PASSED — tsc --noEmit, no errors

## Lines Changed

### `src/hooks/useShiftData.ts`
- +1 line: `const masterDataReadyRef = useRef(false);` (after line 68)
- +3 lines: `finally { masterDataReadyRef.current = true; }` in `fetchMasterData` (after line ~106)
- +5 lines: early-return guard in `fetchData` for `myShift` tab when master data not ready (after line ~146)

### `src/app/app/shifts/manage/page.tsx`
- +1 line: `const calendarInitializedRef = useRef(false);` (after line ~61)
- +4 lines: first-call skip in `handleCalendarDatesSet` using `calendarInitializedRef` (after line ~152)

## Effect
fetchData calls on initial load reduced from 3 → 1 for the shift management page.

---

## Code Review Fixes — Commit: 4a861c4

### Lines Changed

#### `src/hooks/useShiftData.ts`
- Added `useEffect(() => { masterDataReadyRef.current = false; }, [currentOrg]);` after line 69 — resets the master-data-ready guard whenever org changes, re-arming the myShift tab fetch guard for the new org.

#### `src/app/app/shifts/manage/page.tsx`
- Replaced inline `onChange={(_, v) => setActiveTab(v as TabId)}` on `<Tabs>` (line 432) with a multi-line handler that resets `calendarInitializedRef.current = false` when transitioning from `patterns` tab to any calendar tab.

### Typecheck: PASSED — `tsc --noEmit`, no errors

### Commit: 4a861c4
