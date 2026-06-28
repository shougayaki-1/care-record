### Task 1: `getShifts` + `attachReportStatuses` を1クエリに統合
**ファイル:** `src/app/actions/shift.ts`

**現状:** `getShifts()` がシフト取得後、`attachReportStatuses()` で `report_shifts` を別途クエリ → 2 RTT

**修正:** `getShifts()` の SELECT に `report_shifts` をネスト結合し `attachReportStatuses()` 呼び出しを削除する。

```typescript
let query = supabaseAdmin.from('shifts').select(`
    id, organization_id, client_id, title, start_at, end_at, status, cancel_reason,
    clients (id, name),
    ${staffRelation},
    report_shifts (shift_id, is_primary, reports (id, status, deleted_at))
`).eq('organization_id', organizationId)
  .is('deleted_at', null)
  ...
```

返却前に `reports.deleted_at` をJS側でフィルタし、`report_statuses` 配列を組み立てる:
```typescript
return shifts.map(shift => ({
  ...shift,
  report_statuses: (shift.report_shifts ?? [])
    .flatMap(rs => {
      const r = Array.isArray(rs.reports) ? rs.reports[0] : rs.reports;
      if (!r || r.deleted_at) return [];
      return [{ id: r.id, status: r.status, is_primary: rs.is_primary }];
    }),
}));
```

`attachReportStatuses()` 関数は削除。  
`FetchedShiftData` 型 (`src/utils/shiftHelper.ts`) に `report_shifts` フィールドが増えるが、`report_statuses` の型・意味は変わらないのでカレンダー側変更不要。

**効果:** シフト管理画面の毎回の描画で 2 RTT → 1 RTT

---

