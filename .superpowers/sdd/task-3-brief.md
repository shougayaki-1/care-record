### Task 3: UI — ShiftFormModal に自動アサインチェックボックスを追加（方針A フロントエンド）

**Files:**
- Modify: `src/components/shifts/ShiftFormModal.tsx`

**Interfaces:**
- Consumes: `ShiftPayload.autoAssign?: boolean`（Task 2 で追加）
- `onSave(payload: ShiftPayload, shiftId?: string)` に `autoAssign` を含む payload を渡す

- [ ] **Step 1: ShiftFormModal に autoAssign state とチェックボックス UI を追加する**

`src/components/shifts/ShiftFormModal.tsx` を以下のように修正する。

インポートに `FormControlLabel, Checkbox` を追加（既存の mui import に追記）:

```typescript
import {
    Button, Stack,
    Box, Typography,
    IconButton, Tooltip, Divider,
    FormControlLabel, Checkbox     // ← 追加
} from '@/components/ui/mui';
```

`useState` の並びに `autoAssign` state を追加（53行目付近）:

```typescript
    const [cancelReason, setCancelReason] = useState('');
    const [autoAssign, setAutoAssign] = useState(true);   // ← 追加
```

`useEffect` の else ブランチ（新規作成リセット部分）に reset を追加（75行目付近）:

```typescript
            } else {
                setClientId('');
                setSelectedStaffIds([]);
                setStartAt('');
                setEndAt('');
                setCancelReason('');
                setAutoAssign(true);   // ← 追加
            }
```

`handleSave` の payload 組み立て部分に `autoAssign` を追加（90行目付近）:

```typescript
            const payload: ShiftPayload = {
                organizationId,
                clientId,
                title: `${clientName} (${staffNames})`,
                startAt: new Date(startAt).toISOString(),
                endAt: new Date(endAt).toISOString(),
                staffIds: selectedStaffIds,
                isModified: true,
                autoAssign: !initialData ? autoAssign : false,   // ← 追加（新規作成時のみ有効）
            };
```

JSX の日時フィールドの直後（DateTimeField Stack の後、`{initialData && ...}` の前）にチェックボックスを追加:

```tsx
                    {/* 新規作成時のみ: 自動アサインチェックボックス */}
                    {!initialData && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={autoAssign}
                                    onChange={(e) => setAutoAssign(e.target.checked)}
                                    size="small"
                                />
                            }
                            label={
                                <Typography variant="body2" color="text.secondary">
                                    選択したスタッフを基本担当（担当スタッフ設定）にも登録する
                                </Typography>
                            }
                        />
                    )}
```

- [ ] **Step 2: TypeScript コンパイルエラーがないことを確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

期待: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/shifts/ShiftFormModal.tsx
git commit -m "feat(ui): add auto-assign checkbox to ShiftFormModal (方針A)

シフト新規作成時に「選択したスタッフを基本担当にも登録する」チェックボックスを追加。
デフォルト ON。既存シフト編集時は非表示。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

