### Task 4: スタッフに所属事業所を設定できるようにする

**Files:**
- Modify: `src/app/actions/staffs.ts`
- Modify: `src/app/app/staff/page.tsx`

**Interfaces:**
- Consumes: `getOffices`, `type Office` from `@/app/actions/offices`（Task 2）
- Produces: `saveStaff` の `values` に `officeId: string | null` を追加（既存呼び出し元との互換のため optional にはせず、UIから常に渡す）

- [ ] **Step 1: `staffs.ts` の `saveStaff` に `office_id` を追加する**

`src/app/actions/staffs.ts:73-107` の `saveStaff` を変更する:

```typescript
export async function saveStaff(
  organizationId: string,
  values: {
    staffId?: string | null;
    name: string;
    positions: string[];
    employmentType: string;
    workStyle: string;
    linkedUserId?: string | null;
    officeId?: string | null;
  },
) {
  const { userId } = await assertOrgPermission(organizationId, 'staffs');
  const normalized = await normalizeStaffInput(organizationId, values.name, values.positions, values.employmentType, values.workStyle);
  const linkedUserId = values.linkedUserId || null;
  await validateLinkedUser(organizationId, linkedUserId, values.staffId);
  const officeId = values.officeId || null;
  if (officeId) {
    const { data: office } = await supabaseAdmin.from('offices').select('id').eq('id', officeId).eq('organization_id', organizationId).is('archived_at', null).maybeSingle();
    if (!office) throw new Error('選択された事業所が見つかりません');
  }

  let staffId = values.staffId || null;
  if (staffId) {
    await assertStaffOrg(staffId, organizationId);
    const { error } = await supabaseAdmin.from('staffs').update({ ...normalized, user_id: linkedUserId, office_id: officeId }).eq('id', staffId);
    if (error) throw sanitizeDbError(error, 'action.staffs');
  } else {
    const { data, error } = await supabaseAdmin.from('staffs').insert({ organization_id: organizationId, ...normalized, user_id: linkedUserId, office_id: officeId }).select('id').single();
    if (error || !data) throw new Error(error?.message || 'スタッフを作成できませんでした');
    staffId = data.id;
  }
  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: values.staffId ? 'staff.update' : 'staff.create',
    resourceType: 'staff',
    resourceId: staffId,
  });
  return { success: true, staffId };
}
```

- [ ] **Step 2: `staff/page.tsx` にUIを追加する**

1. `StaffData` 型（`src/app/app/staff/page.tsx:43-53`）に `office_id: string | null;` を追加
2. `fetchStaffData` の Supabase select（`:91`）に `office_id` を追加: `` `id, name, positions, employment_type, work_style, user_id, archived_at, sort_order, office_id, profiles:profiles!user_id(name)` ``
3. `StaffPageData` / `initialStaffPageData`（`:55-64`）に `officeList: Office[]` を追加し、`fetchStaffData` 内で `getOffices(currentOrg.id)` を呼んで含める（import: `import { getOffices, type Office } from '@/app/actions/offices';`）
4. state追加（`:81` 付近）: `const [officeId, setOfficeId] = useState<string>('none');`
5. `handleSave`（`:135-154`）の `saveStaff` 呼び出しに `officeId: officeId === 'none' ? null : officeId` を追加
6. `handleOpenAdd` / `handleOpenEdit`（`:156-165`）でそれぞれ `setOfficeId('none')` / `setOfficeId(staff.office_id || 'none')` を追加
7. ダイアログJSX（`:410-425`）の `workStyle` の `SelectField` の直後に追加:

```tsx
                <SelectField
                    value={officeId}
                    onChange={setOfficeId}
                    label="所属事業所"
                    options={[{ value: 'none', label: '未設定' }, ...officeList.map((office) => ({ value: office.id, label: office.name }))]}
                />
```

（`officeList` は `const { staffList, accountList, positionPresets, officeList } = staffPageData;` のように分割代入に追加する）

- [ ] **Step 3: 動作確認**

Run: `npm run dev` でスタッフ管理画面を開き、追加・編集ダイアログに「所属事業所」セレクトが表示され、選択して保存後に一覧再取得しても選択値が保持されることをブラウザで確認する。

- [ ] **Step 4: typecheck / lint**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/actions/staffs.ts src/app/app/staff/page.tsx
git commit -m "feat: allow assigning staff to an office"
```

---

