## Task 2: `shiftSegments.ts` — セグメント保存後に `shift_staffs` を自動同期

`saveShiftSegments` 実行後、そのシフトの全セグメントからユニークなスタッフIDを集め、`shift_staffs` を置き換える。これにより既存コードが `shift_staffs` を参照し続けても正しい値が得られる。

**Files:**
- Modify: `src/app/actions/shiftSegments.ts`

- [ ] **Step 1: `saveShiftSegments` の末尾に `shift_staffs` 同期処理を追加**

`src/app/actions/shiftSegments.ts` の `saveShiftSegments` 関数の末尾（`return` 直前）に追記:

```typescript
// Derive shift_staffs from segment staffs (shift_staffs is now a read-only denorm)
const { data: segStaffs } = await supabaseAdmin
    .from('shift_segment_staffs')
    .select('staff_id, shift_segments!inner(shift_id)')
    .eq('shift_segments.shift_id', shiftId);

const uniqueStaffIds = [...new Set((segStaffs ?? []).map((r: { staff_id: string }) => r.staff_id))];
await supabaseAdmin.from('shift_staffs').delete().eq('shift_id', shiftId);
if (uniqueStaffIds.length > 0) {
    await supabaseAdmin.from('shift_staffs').insert(
        uniqueStaffIds.map((staff_id: string) => ({ shift_id: shiftId, staff_id }))
    );
}
```

- [ ] **Step 2: 動作確認（手動）**

既存シフトのセグメントを保存 → `shift_staffs` がセグメントのスタッフと一致していることを Supabase Studio で確認。

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/shiftSegments.ts
git commit -m "feat(segments): sync shift_staffs from segment staffs on save"
```

---

