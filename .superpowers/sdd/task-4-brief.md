### Task 4: UI — ShiftPatternModal に自動アサインチェックボックスを追加（方針A ひな形）

**Files:**
- Modify: `src/components/shifts/ShiftPatternModal.tsx`

**Interfaces:**
- Consumes: `ShiftPatternPayload.autoAssign?: boolean`（Task 2 で追加）
- `onSave(payload: ShiftPatternPayload, patternId?: string)` に `autoAssign` を含む payload を渡す

- [ ] **Step 1: ShiftPatternModal に autoAssign state とチェックボックス UI を追加する**

`src/components/shifts/ShiftPatternModal.tsx` を以下のように修正する。

インポートに `FormControlLabel, Checkbox` を追加（既存の mui import に追記）:

```typescript
import {
    Stack, FormControl,
    Select, MenuItem, Box, Typography, Checkbox, FormGroup,
    FormControlLabel
} from '@/components/ui/mui';
```

（すでに `Checkbox` と `FormControlLabel` がインポートされているので変更不要の場合はスキップ）

`useState` の並びに `autoAssign` state を追加（83行目付近）:

```typescript
    const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
    const [autoAssign, setAutoAssign] = useState(true);   // ← 追加
```

`useEffect` の else ブランチ（新規作成リセット部分）に reset を追加（113行目付近）:

```typescript
            } else {
                setClientId('');
                setSelectedStaffIds([]);
                setStartTime('10:00');
                setEndTime('12:00');
                setFreq('WEEKLY');
                setIntervalCount(1);
                setSelectedDays([]);
                setSelectedWeeks([]);
                setAutoAssign(true);   // ← 追加
            }
```

`handleSave` の `onSave` 呼び出し部分に `autoAssign` を追加（142行目付近）:

```typescript
            await onSave({
                organizationId,
                clientId,
                title: `${clientName} (${staffNames})`,
                startTime: startTime.length === 5 ? `${startTime}:00` : startTime,
                endTime: endTime.length === 5 ? `${endTime}:00` : endTime,
                rrule: rruleStr,
                staffIds: selectedStaffIds,
                autoAssign: !initialData ? autoAssign : false,  // ← 追加（新規作成時のみ）
            }, initialData?.id);
```

JSX の `MultiSelectField` の直後（繰り返しスケジュール Box の前）にチェックボックスを追加:

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
git add src/components/shifts/ShiftPatternModal.tsx
git commit -m "feat(ui): add auto-assign checkbox to ShiftPatternModal (方針A)

ひな形新規作成時に「選択したスタッフを基本担当にも登録する」チェックボックスを追加。
デフォルト ON。既存ひな形編集時は非表示。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

