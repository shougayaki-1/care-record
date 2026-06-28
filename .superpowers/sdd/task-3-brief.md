### Task 3: Statistics の重複シフトクエリを統合
**ファイル:** `src/app/actions/statistics.ts`

**現状:** `shifts`（集計用）と `shiftsWithLinks`（予実比較用）で同一期間の `shifts` を2回クエリ。

**修正:** Query 1 と Query 3 を1つに統合し、`Promise.all` の4並列に削減:
```typescript
const [{ data: shiftsWithLinks, error: shiftsError }, { data: reports, ... }, ...] = await Promise.all([
  supabaseAdmin.from('shifts').select(`
    id, start_at, end_at, status, client_id,
    clients (name),
    shift_staffs (staff_id, staffs (name)),
    report_shifts (is_primary, reports (id, start_at, end_at, status, report_values (data)))
  `)
  .eq('organization_id', organizationId)
  .neq('status', 'cancelled')
  .is('deleted_at', null)
  .gte('end_at', startAt)
  .lte('start_at', endAt),
  // ... 残り3クエリ
]);
```

`shifts`（シンプル集計用）は `shiftsWithLinks` から派生させる:
```typescript
return {
  shifts: (shiftsWithLinks ?? []).map(({ report_shifts: _, ...s }) => s), // report_shifts除去
  shiftsWithLinks: shiftsWithLinks ?? [],
  ...
};
```

ページ側 (`src/app/app/statistics/page.tsx`) の `ShiftData` 型と `ShiftWithLinks` 型の整合性を確認して調整。

**効果:** Statistics 画面で DBクエリ 5本 → 4本（最重量クエリを削除）

---

