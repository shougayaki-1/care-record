# Task 3 Report: Statistics 重複シフトクエリ統合

## STATUS: DONE

## Commit
490f6b2 — `perf(db): merge duplicate shifts queries in statistics into single query`

## Summary
`getStatisticsData()` の `Promise.all` を5並列から4並列に削減。旧 Query 1 (shifts) と Query 3 (shiftsWithLinks) を1本の統合クエリに置き換えた。

- 統合クエリは両方のカラム (`status`, `staff_id`, `report_shifts`) をすべて含む
- `deleted_at IS NULL` フィルタを統合クエリに適用（旧 Query 3 のみにあったフィルタ）
- `shifts` は `shiftsWithLinks` から `report_shifts` を除去して派生させる
- `shiftsWithLinksError` チェックを削除し、`shiftsError` に統合

## Type Check
`npm run typecheck` — エラーなし

## Files Modified
- `/Users/shoug/Documents/GitHub/care-record/src/app/actions/statistics.ts` のみ（page.tsx の型は既に互換性あり、変更不要）

## Concerns
なし
