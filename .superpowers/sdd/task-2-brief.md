### Task 2: Server Action — シフト作成時の自動アサイン（方針A バックエンド）

**Files:**
- Modify: `src/app/actions/shift.ts`

**Interfaces:**
- Produces: `ShiftPayload.autoAssign?: boolean` フィールド、`ShiftPatternPayload.autoAssign?: boolean` フィールド
- `createShift()` が `autoAssign=true` のとき `assignments` に upsert する

- [ ] **Step 1: `ShiftPayload` と `ShiftPatternPayload` に `autoAssign` を追加し、`createShift` にロジックを追加する**

`src/app/actions/shift.ts` の `ShiftPayload` 型定義（59行目付近）を修正:

```typescript
export type ShiftPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startAt: string;
    endAt: string;
    staffIds: string[];
    status?: 'published' | 'cancelled';
    cancelReason?: string;
    patternId?: string;
    isModified?: boolean;
    autoAssign?: boolean;  // ← 追加
};
```

`src/app/actions/shift.ts` の `ShiftPatternPayload` 型定義（72行目付近）を修正:

```typescript
export type ShiftPatternPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startTime: string;
    endTime: string;
    rrule: string;
    staffIds: string[];
    autoAssign?: boolean;  // ← 追加
};
```

`createShift` 関数（597行目付近）の末尾に自動アサイン処理を追加:

```typescript
export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
    const actor = await assertShiftPermission(payload.organizationId, 'create', { clientId: payload.clientId });
    const result = await createShiftInternal(payload, awaitSync);
    await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift.create', resourceType: 'shift', resourceId: result.shiftId });

    // 自動アサイン: シフト作成時に選択スタッフを assignments に登録（チェックボックス ON 時のみ）
    if (payload.autoAssign && payload.staffIds.length > 0) {
        await upsertAssignmentsForStaffs(payload.organizationId, payload.clientId, payload.staffIds);
    }

    return result;
}
```

`createShiftPattern` 関数（831行目付近）にも自動アサインを追加:

```typescript
export async function createShiftPattern(payload: ShiftPatternPayload) {
    const actor = await assertShiftPermission(payload.organizationId, 'create', { clientId: payload.clientId });
    const { data: pattern, error } = await supabaseAdmin.from('shift_patterns').insert({
        organization_id: payload.organizationId, client_id: payload.clientId, title: payload.title,
        start_time: payload.startTime, end_time: payload.endTime, rrule: payload.rrule
    }).select('id').single();
    if (error || !pattern) throw error;

    if (payload.staffIds.length > 0) {
        const inserts: PatternStaffInsert[] = payload.staffIds.map(sid => ({ pattern_id: pattern.id, staff_id: sid }));
        await supabaseAdmin.from('shift_pattern_staffs').insert(inserts);
    }

    // 自動アサイン: ひな形作成時に選択スタッフを assignments に登録（チェックボックス ON 時のみ）
    if (payload.autoAssign && payload.staffIds.length > 0) {
        await upsertAssignmentsForStaffs(payload.organizationId, payload.clientId, payload.staffIds);
    }

    await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift_pattern.create', resourceType: 'shift_pattern', resourceId: pattern.id });
    return { success: true };
}
```

`src/app/actions/shift.ts` の `type ShiftStaffInsert` 定義直前（82行目付近）に `upsertAssignmentsForStaffs` ヘルパーを追加:

```typescript
/** 指定スタッフを利用者の担当者として upsert する（既存エントリは変更しない） */
async function upsertAssignmentsForStaffs(organizationId: string, clientId: string, staffIds: string[]) {
    const { data: staffRows } = await supabaseAdmin
        .from('staffs')
        .select('id, user_id')
        .eq('organization_id', organizationId)
        .in('id', staffIds)
        .is('deleted_at', null);
    if (!staffRows || staffRows.length === 0) return;
    await supabaseAdmin.from('assignments').upsert(
        staffRows.map(s => ({
            client_id: clientId,
            staff_id: s.id,
            helper_id: s.user_id ?? null,
        })),
        { onConflict: 'client_id,staff_id', ignoreDuplicates: true }
    );
}
```

- [ ] **Step 2: TypeScript コンパイルエラーがないことを確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

期待: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/app/actions/shift.ts
git commit -m "feat(actions): add autoAssign option to createShift and createShiftPattern (方針A)

シフト作成・ひな形作成時に autoAssign=true を渡すと、
選択スタッフを assignments テーブルにも自動登録する。
既存エントリは更新しない（ignoreDuplicates）。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

