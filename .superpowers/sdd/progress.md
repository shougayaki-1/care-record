# SDD Progress Ledger — Plan: シフト連動型記録権限修正

## Tasks
- [ ] Task 1: DB マイグレーション — can_access_client + save_report_atomic に shift_staffs OR 条件追加
- [ ] Task 2: Server Action — autoAssign オプション追加 (ShiftPayload, ShiftPatternPayload, createShift, createShiftPattern)
- [ ] Task 3: UI — ShiftFormModal に自動アサインチェックボックス追加
- [ ] Task 4: UI — ShiftPatternModal に自動アサインチェックボックス追加
- [ ] Task 5: UI — 利用者一覧に担当者数列追加

## Log
Task 1 (DBマイグレーション): complete (commits 6a8c37a..84e86f5, review clean)
Task 2 (autoAssign Server Action): complete (commits 84e86f5..4bcf44b, review clean — Important fix: error propagation in upsertAssignmentsForStaffs)
Task 3 (ShiftFormModal checkbox): complete (commits 4bcf44b..c9ab29f, review clean)
Task 4 (ShiftPatternModal checkbox): complete (commits c9ab29f..ca6df7e, review clean)
Task 5 (clients list assignment count): complete (commits ca6df7e..06bf2bb, review clean)
Final whole-branch review: complete (commits 6a8c37a..7d6e90f, Critical×0, Important×3 fixed: cancelled-shift guard in can_access_client + save_report_atomic auth checks ×2, design comment added)
