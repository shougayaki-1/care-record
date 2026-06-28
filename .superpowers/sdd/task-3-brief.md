## Task 3: `shift.ts` — `ShiftPayload` から `staffIds` 削除、`segments` 追加

**Files:**
- Modify: `src/app/actions/shift.ts`

**Interfaces:**
- Produces: `ShiftPayload` に `staffIds` なし、`segments?: SaveSegmentInput[]` あり

- [ ] **Step 1: `ShiftPayload` の型定義を変更**

`src/app/actions/shift.ts` の `ShiftPayload` 型（line 59-71）:

```typescript
// SaveSegmentInput のインポートを追加（ファイル先頭付近）
import { saveShiftSegments, type SaveSegmentInput } from './shiftSegments';

export type ShiftPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startAt: string;
    endAt: string;
    segments?: SaveSegmentInput[];   // セグメントで担当スタッフ・時間帯を定義
    status?: 'published' | 'cancelled';
    cancelReason?: string;
    patternId?: string;
    isModified?: boolean;
    autoAssign?: boolean;
};
```

- [ ] **Step 2: `ShiftPatternPayload` の `staffIds` を削除**

```typescript
export type ShiftPatternPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startTime: string;
    endTime: string;
    rrule: string;
    segments?: ShiftPatternSegmentInput[];
    autoAssign?: boolean;
};
```

- [ ] **Step 3: `createShift` を更新 — セグメント保存 + autoAssign**

`createShift` 関数（line 819-829）:

```typescript
export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
    const actor = await assertShiftPermission(payload.organizationId, 'create', { clientId: payload.clientId });
    const result = await createShiftInternal(payload, awaitSync);

    if (payload.segments && payload.segments.length > 0) {
        await saveShiftSegments(payload.organizationId, result.shiftId, payload.segments);
    }

    if (payload.autoAssign && payload.segments && payload.segments.length > 0) {
        const staffIds = uniqueStaffIdsFromSegments(payload.segments);
        if (staffIds.length > 0) {
            await upsertAssignmentsForStaffs(payload.organizationId, payload.clientId, staffIds);
        }
    }

    await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift.create', resourceType: 'shift', resourceId: result.shiftId });
    return result;
}
```

- [ ] **Step 4: `createShiftInternal` から `replaceShiftStaffs` 呼び出しを削除**

`createShiftInternal` の `await replaceShiftStaffs(shift.id, payload.staffIds);` の行を削除する。

- [ ] **Step 5: `updateShift` の `staffIds` 参照を削除**

`updateShiftInternal` の `if (payload.staffIds !== undefined)` ブロック（line 899-907）をまるごと削除する。

- [ ] **Step 6: `uniqueStaffIdsFromSegments` を段階対応**

`SaveSegmentInput[]` を受け取れるようオーバーロードか型を拡張（`ShiftPatternSegmentInput[]` と `SaveSegmentInput[]` は `staffs` フィールドが共通）:

```typescript
function uniqueStaffIdsFromSegments(
    segments: Array<{ staffs?: Array<{ staff_id: string }> }> | undefined
): string[] {
    const ids = new Set<string>();
    for (const segment of segments ?? []) {
        for (const staff of segment.staffs ?? []) {
            if (staff.staff_id) ids.add(staff.staff_id);
        }
    }
    return Array.from(ids);
}
```

- [ ] **Step 7: `normalizePatternSegments` のフォールバック削除**

`normalizePatternSegments`（line 135-158）からの `payload.staffIds` フォールバックを削除。セグメントがない場合はフォールバック無しで空配列を返す（呼び出し側でバリデーション済みの前提）:

```typescript
function normalizePatternSegments(payload: ShiftPatternPayload): ShiftPatternSegmentInput[] {
    const inputSegments = (payload.segments ?? []).filter((segment) => segment.start_time && segment.end_time);
    // No fallback — caller must ensure at least one segment is provided
    return inputSegments.map((segment, index) => ({
        service_type_id: segment.service_type_id || null,
        start_time: normalizeTimeForDb(segment.start_time),
        end_time: normalizeTimeForDb(segment.end_time),
        sort_order: index,
        staffs: (segment.staffs ?? [])
            .filter((staff) => Boolean(staff.staff_id))
            .map((staff) => ({
                staff_id: staff.staff_id,
                staff_role_id: staff.staff_role_id || null,
            })),
    }));
}
```

- [ ] **Step 8: パターン展開 (`expandMonthlyPattern`) の fallbackStaffIds 除去**

`saveShiftSegmentsFromPattern` を呼ぶ箇所で `fallbackStaffIds` に空配列を渡す（セグメントは常にパターンから来る）:

`src/app/actions/shift.ts` の各 `expandMonthlyPattern` 内で:
```typescript
// Before:
const staffIds = segmentStaffIds.length > 0 ? segmentStaffIds : p.shift_pattern_staffs.map(...);
await saveShiftSegmentsFromPattern(shift.id, p.shift_pattern_segments, occurrence, staffIds);

// After:
await saveShiftSegmentsFromPattern(shift.id, p.shift_pattern_segments, occurrence, []);
```

- [ ] **Step 9: TypeScript のビルドエラーを修正**

```bash
npx tsc --noEmit 2>&1 | head -40
```

`staffIds` を参照している箇所がコンパイルエラーになるのでひとつずつ修正する。

- [ ] **Step 10: Commit**

```bash
git add src/app/actions/shift.ts
git commit -m "refactor(shift): remove staffIds from ShiftPayload, segments are now the sole staff unit"
```

---

