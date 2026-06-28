### Task 2: `useShiftData` の初期ロード多重 fetch 防止
**ファイル:** `src/hooks/useShiftData.ts`, `src/app/app/shifts/manage/page.tsx`

**現状の問題:**
1. `useEffect([wsLoading, currentOrg])` → `fetchData()` (currentStaffId=null)
2. FullCalendar の `onDatesSet` → `handleCalendarDatesSet` → `fetchData()` (重複)
3. `fetchMasterData()` 完了で `currentStaffId` がセット → `useEffect` 再発火 → 3回目 `fetchData()`

**修正: `useShiftData.ts`**
- `masterDataReadyRef = useRef(false)` を追加
- `fetchMasterData` 完了時に `masterDataReadyRef.current = true` をセット
- `fetchData` の先頭で `myShift` タブかつ `!masterDataReadyRef.current` のとき early return

**修正: `shifts/manage/page.tsx`**
- `calendarInitializedRef = useRef(false)` を追加
- `handleCalendarDatesSet` 内で初回発火を skip:
  ```typescript
  const handleCalendarDatesSet = useCallback((info: DatesSetArg) => {
    if (activeTab === 'patterns') return;
    if (!calendarInitializedRef.current) {
      calendarInitializedRef.current = true;
      return; // useEffect側のfetchDataに任せる
    }
    const range: ShiftDateRange = { start: info.start, end: info.end };
    fetchData(true, range);
  }, [activeTab, fetchData]);
  ```

**効果:** シフト管理画面の初期ロードで fetchData 3回 → 1回

---

