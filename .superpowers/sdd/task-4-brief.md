## Task 4: `ShiftFormModal` — スタッフピッカー廃止、インラインセグメント必須化

`ShiftPatternModal` と同じインラインセグメント編集パターンを `ShiftFormModal` の CREATE モードに導入する。EDIT モードは既存の `ShiftSegmentEditor` をそのまま使うが、「任意」から「必須」に変える。

**Files:**
- Modify: `src/components/shifts/ShiftFormModal.tsx`

型定義の変更（Props の `onSave` シグネチャ）:
```typescript
onSave: (payload: ShiftPayload, shiftId?: string) => Promise<void>
// ShiftPayload に staffIds がなくなり segments が入るだけで変更不要
```

- [ ] **Step 1: インポートに `SaveSegmentInput` を追加**

```typescript
import type { SaveSegmentInput } from '@/app/actions/shiftSegments';
import { getServiceTypes, type ServiceType } from '@/app/actions/serviceTypes';
import { getStaffRoles, type StaffRole } from '@/app/actions/staffRoles';
```

- [ ] **Step 2: ローカル状態から `selectedStaffIds` を削除、`segments` を追加**

```typescript
// 削除: const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);

type SegmentDraft = {
    service_type_id: string;
    start_at: string;
    end_at: string;
    staffs: { staff_id: string; staff_role_id: string }[];
};

const [segments, setSegments] = useState<SegmentDraft[]>([]);
const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
const [staffRoles, setStaffRoles] = useState<StaffRole[]>([]);
```

- [ ] **Step 3: `useEffect` — open 時にサービス種別・スタッフ役割をロード、`segments` を初期化**

```typescript
useEffect(() => {
    if (!open) return;
    // Load master data for the inline segment editor
    Promise.all([
        getServiceTypes(organizationId),
        getStaffRoles(organizationId),
    ]).then(([types, roles]) => {
        setServiceTypes(types);
        setStaffRoles(roles);
    });

    if (initialData) {
        setClientId(initialData.client_id || '');
        const formatDatetime = (isoStr: string) => { /* same as before */ };
        setStartAt(formatDatetime(initialData.start_at));
        setEndAt(formatDatetime(initialData.end_at));
        setCancelReason(initialData.cancel_reason || '');
        setSegments([]); // EDIT mode: ShiftSegmentEditor handles loading from server
    } else {
        setClientId('');
        setSegments([]);
        setStartAt('');
        setEndAt('');
        setCancelReason('');
        setAutoAssign(true);
    }
}, [open, initialData, organizationId]);
```

- [ ] **Step 4: 新規作成時のデフォルトセグメント自動生成（開始・終了時刻が揃ったら）**

```typescript
useEffect(() => {
    if (initialData || segments.length > 0) return;
    if (!startAt || !endAt) return;
    // Seed one blank segment covering the full shift window
    setSegments([{
        service_type_id: '',
        start_at: startAt,
        end_at: endAt,
        staffs: [],
    }]);
}, [startAt, endAt, initialData, segments.length]);
```

- [ ] **Step 5: `handleSave` のバリデーションを更新**

CREATE モード:
```typescript
const handleSave = async () => {
    if (!clientId || !startAt || !endAt) {
        showToast('必須項目（利用者、日時）をすべて入力してください', 'warning');
        return;
    }
    if (!initialData) {
        // CREATE: validate inline segments
        if (segments.length === 0) {
            showToast('サービス区間を1つ以上追加してください', 'warning');
            return;
        }
        if (segments.some(s => s.staffs.length === 0)) {
            showToast('すべてのサービス区間に担当スタッフを設定してください', 'warning');
            return;
        }
    }
    // ...
};
```

- [ ] **Step 6: `payload` 組み立てを変更**

```typescript
const staffNames = segments.flatMap(s =>
    s.staffs.map(ss => staffs.find(st => st.id === ss.staff_id)?.name ?? '')
).filter(Boolean);
const uniqueStaffNames = [...new Set(staffNames)];

const payload: ShiftPayload = {
    organizationId,
    clientId,
    title: clientName + (uniqueStaffNames.length > 0 ? ` (${uniqueStaffNames.join(', ')})` : ''),
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(endAt).toISOString(),
    segments: !initialData
        ? segments.map((s, i) => ({
            service_type_id: s.service_type_id || null,
            start_at: new Date(s.start_at).toISOString(),
            end_at: new Date(s.end_at).toISOString(),
            sort_order: i,
            staffs: s.staffs.map(ss => ({ staff_id: ss.staff_id, staff_role_id: ss.staff_role_id || null })),
        }))
        : undefined,
    isModified: true,
    autoAssign: !initialData ? autoAssign : false,
};
```

- [ ] **Step 7: JSX 変更 — スタッフ `MultiSelectField` を削除、CREATE 時のインラインセグメントエディタを追加**

`MultiSelectField`（スタッフ選択, line 213-221）を削除する。

CREATE モード用のインラインセグメント編集 UI を `DateTimeField` 群の下に追加:
```tsx
{/* CREATE モードのみ: インラインセグメント編集 */}
{!initialData && (
    <Box border="1px solid" borderColor="divider" borderRadius={2} p={2}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
            サービス区間・担当スタッフ（必須）
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
            時間帯ごとにサービス種別と担当スタッフを設定してください。
        </Typography>
        {segments.map((seg, idx) => (
            <Box key={idx} mb={2} p={1.5} border="1px solid" borderColor="divider" borderRadius={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="caption">区間 {idx + 1}</Typography>
                    <IconButton size="small" color="error"
                        onClick={() => setSegments(prev => prev.filter((_, i) => i !== idx))}>
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Stack>
                {/* 開始/終了 */}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} mb={1}>
                    <DateTimeField label="開始" size="small" fullWidth value={seg.start_at}
                        onChange={e => setSegments(prev => prev.map((s, i) => i === idx ? { ...s, start_at: e.target.value } : s))} />
                    <DateTimeField label="終了" size="small" fullWidth value={seg.end_at}
                        onChange={e => setSegments(prev => prev.map((s, i) => i === idx ? { ...s, end_at: e.target.value } : s))} />
                </Stack>
                {/* サービス種別 */}
                <SelectField
                    label="サービス種別"
                    size="small"
                    value={seg.service_type_id}
                    options={[{ value: '', label: '（なし）' }, ...serviceTypes.map(t => ({ value: t.id, label: t.name }))]}
                    onChange={val => setSegments(prev => prev.map((s, i) => i === idx ? { ...s, service_type_id: val } : s))}
                />
                {/* 担当スタッフ（必須） */}
                <MultiSelectField
                    required
                    label="担当スタッフ（必須）"
                    options={staffs}
                    value={staffs.filter(st => seg.staffs.some(ss => ss.staff_id === st.id))}
                    onChange={selected => setSegments(prev => prev.map((s, i) =>
                        i === idx ? { ...s, staffs: selected.map(st => ({ staff_id: st.id, staff_role_id: '' })) } : s
                    ))}
                    getOptionLabel={st => st.name}
                    getOptionValue={st => st.id}
                />
            </Box>
        ))}
        <Button size="small" startIcon={<AddIcon />}
            onClick={() => setSegments(prev => [...prev, { service_type_id: '', start_at: startAt, end_at: endAt, staffs: [] }])}>
            区間を追加
        </Button>
    </Box>
)}
```

- [ ] **Step 8: EDIT モードのセグメントセクションを「任意」→「必須」に表記変更**

line 267-268 付近の `Typography` コンポーネントを更新:
```tsx
<Typography variant="subtitle2" fontWeight="bold" color="text.primary" gutterBottom>
    サービス区間（必須）
</Typography>
<Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
    時間帯ごとにサービス種別・担当スタッフを設定してください。設定した区間ごとにサービス提供記録が作成されます。
</Typography>
```

- [ ] **Step 9: TypeScript チェック**

```bash
npx tsc --noEmit 2>&1 | grep ShiftFormModal
```

Expected: エラーなし

- [ ] **Step 10: Commit**

```bash
git add src/components/shifts/ShiftFormModal.tsx
git commit -m "feat(ui): replace shift-level staff picker with required inline segment editor in ShiftFormModal"
```

---

