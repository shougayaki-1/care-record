# SDD Progress Ledger — Plan: サービス区間を唯一の時間・スタッフ単位とする

## Tasks
- [x] Task 1: DB Migration — shift_segment_staffs アクセス制御対応
- [x] Task 2: shiftSegments.ts — shift_staffs 自動同期
- [x] Task 3: shift.ts — staffIds 削除、segments 追加
- [x] Task 4: ShiftFormModal — スタッフピッカー廃止、インラインセグメント必須化
- [x] Task 5: ShiftPatternModal — staffIds フォールバック削除、セグメント必須化
- [x] Task 6: Record Page — segmentId 必須化

## Log
Base commit: 382c1bf
Task 1: complete (commits 382c1bf..aa99f5b, review clean — Minor: shift_segments has no deleted_at, finding is N/A)
Task 2: complete (commits aa99f5b..526c39d, review clean)
Task 3: complete (commits 526c39d..80cfe43, review clean)
Task 4: complete (commits 80cfe43..45cd2d6, review clean — Minor: staffRoles fetch unused (plan-mandated); key=idx; no catch on Promise.all)
Task 5: complete (commits 45cd2d6..b07959a, review clean)
Task 6: complete (commits b07959a..bc4a3d1, review clean)
Fix: complete (commit 196cb4e — Google Calendar sync ordering + deleteShiftSegment shift_staffs sync)
