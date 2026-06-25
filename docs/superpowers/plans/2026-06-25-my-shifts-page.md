# 自分のシフトページ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スタッフが自分のシフトを月別に確認し、タップで提供記録フォームへ遷移できる専用ページ `/app/shifts/my` を新設する。

**Architecture:** サーバーアクション `getMyShiftsWithStatus` でシフトと提供記録状態を一括取得する。新規ページはリスト表示・カレンダー表示をトグルで切り替え可能にし、`ShiftCalendarViewer` を再利用する。サイドバーに「自分のシフト」リンクを追加して既存の「シフト管理」の下に置く。

**Tech Stack:** Next.js App Router, MUI v5, Supabase (supabaseAdmin), FullCalendar (ShiftCalendarViewer 再利用)

## Global Constraints

- TypeScript strict mode
- MUI v5 コンポーネントを使用（既存の `@/components/ui/mui` import パターンに従う）
- Server actions は `'use server'` + `supabaseAdmin` + `getAuthedUser` パターン
- `reports` と `shifts` の間に外部キー制約は**無い**（Supabase の埋め込みリレーション不可）
- キャンセル済みシフト（`status === 'cancelled'`）はタップしても記録フォームに遷移しない（toast 表示）
- カレンダービューでは既存の `ShiftCalendarViewer` コンポーネントを再利用する

---

## ファイル構成

| 操作 | パス | 役割 |
|------|------|------|
| 新規作成 | `src/app/app/shifts/my/page.tsx` | 自分のシフトページ |
| 修正 | `src/app/actions/shift.ts` | `getMyShiftsWithStatus` アクション追加 |
| 修正 | `src/components/layout/AppLayout.tsx` | サイドバーに「自分のシフト」リンク追加 |

---

### Task 1: `getMyShiftsWithStatus` サーバーアクション追加

**Files:**
- Modify: `src/app/actions/shift.ts` （末尾に追記）

**Interfaces:**
- Produces:
```ts
export type MyShiftItem = {
  id: string;
  organization_id: string;
  client_id: string;
  title: string | null;
  start_at: string;
  end_at: string;
  status: string;  // 'published' | 'cancelled'
  cancel_reason: string | null;
  clients: { id: string; name: string } | null;
  shift_staffs: { staff_id: string; staffs: { name: string } | null }[];
  report: { id: string; status: string } | null;
};

export async function getMyShiftsWithStatus(
  organizationId: string,
  startDate: string,
  endDate: string
): Promise<MyShiftItem[]>
```

- [ ] **Step 1: `src/app/actions/shift.ts` の末尾に型定義とアクションを追加する**

```ts
export type MyShiftItem = {
  id: string;
  client_id: string;
  title: string | null;
  start_at: string;
  end_at: string;
  status: string;
  cancel_reason: string | null;
  clients: { id: string; name: string } | null;
  shift_staffs: { staff_id: string; staffs: { name: string } | null }[];
  report: { id: string; status: string } | null;
};

export async function getMyShiftsWithStatus(
  organizationId: string,
  startDate: string,
  endDate: string
): Promise<MyShiftItem[]> {
  const user = await getAuthedUser();

  // ログインユーザーのスタッフIDを取得
  const { data: staffRow } = await supabaseAdmin
    .from('staffs')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!staffRow) return [];

  // 自分が担当するシフトを取得
  const { data: shifts, error } = await supabaseAdmin
    .from('shifts')
    .select(`
      id,
      client_id,
      title,
      start_at,
      end_at,
      status,
      cancel_reason,
      clients (id, name),
      shift_staffs!inner (staff_id, staffs (name))
    `)
    .eq('organization_id', organizationId)
    .eq('shift_staffs.staff_id', staffRow.id)
    .is('deleted_at', null)
    .gte('start_at', startDate)
    .lte('start_at', endDate)
    .order('start_at', { ascending: true });

  if (error) throw error;
  if (!shifts || shifts.length === 0) return [];

  // シフトIDに紐付く提供記録のステータスを一括取得（FK制約なしのため別クエリ）
  const shiftIds = shifts.map(s => s.id);
  const { data: reports } = await supabaseAdmin
    .from('reports')
    .select('id, shift_id, status')
    .in('shift_id', shiftIds)
    .is('deleted_at', null);

  const reportByShiftId = new Map(
    (reports ?? []).map(r => [r.shift_id, { id: r.id, status: r.status }])
  );

  return (shifts as unknown as Omit<MyShiftItem, 'report'>[]).map(shift => ({
    ...shift,
    report: reportByShiftId.get(shift.id) ?? null,
  }));
}
```

- [ ] **Step 2: ビルドエラーがないか確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record && npx tsc --noEmit 2>&1 | head -30
```

Expected: エラーなし（または既存エラーのみ）

- [ ] **Step 3: コミット**

```bash
git add src/app/actions/shift.ts
git commit -m "feat: add getMyShiftsWithStatus server action"
```

---

### Task 2: 自分のシフトページ新規作成

**Files:**
- Create: `src/app/app/shifts/my/page.tsx`

**Interfaces:**
- Consumes: `getMyShiftsWithStatus` from `@/app/actions/shift` (Task 1)
- Consumes: `ShiftCalendarViewer` from `@/components/shifts/ShiftCalendarViewer`
- Consumes: `convertToCalendarEvents` from `@/utils/shiftHelper`
- Consumes: `useWorkspace` from `@/context/WorkspaceContext`
- Consumes: `useToast` from `@/components/ui/ToastProvider`
- Consumes: `MyShiftItem` type from `@/app/actions/shift`

- [ ] **Step 1: ディレクトリを作成してページファイルを作成する**

`src/app/app/shifts/my/page.tsx` を以下の内容で作成する：

```tsx
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Box, Typography, CircularProgress, Stack, Chip, Paper,
  IconButton, ToggleButton, ToggleButtonGroup, Tooltip
} from '@/components/ui/mui';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ListIcon from '@mui/icons-material/List';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EditNoteIcon from '@mui/icons-material/EditNote';
import FullCalendar from '@fullcalendar/react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { getMyShiftsWithStatus, type MyShiftItem } from '@/app/actions/shift';
import { ShiftCalendarViewer } from '@/components/shifts/ShiftCalendarViewer';
import { convertToCalendarEvents } from '@/utils/shiftHelper';

type ViewMode = 'list' | 'calendar';

const REPORT_STATUS_LABELS: Record<string, { label: string; color: 'default' | 'primary' | 'warning' | 'success' | 'error' }> = {
  draft:    { label: '下書き',   color: 'primary' },
  pending:  { label: '送信済み', color: 'warning' },
  approved: { label: '承認済み', color: 'success' },
  remanded: { label: '差戻し',   color: 'error' },
};

function formatDateLabel(startAt: string): string {
  const d = new Date(startAt);
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
}

function formatTimeRange(startAt: string, endAt: string): string {
  const fmt = (s: string) => {
    const d = new Date(s);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${fmt(startAt)} 〜 ${fmt(endAt)}`;
}

function ShiftListItem({ shift, onClick }: { shift: MyShiftItem; onClick: () => void }) {
  const isCancelled = shift.status === 'cancelled';
  const clientName = shift.clients?.name ?? '';
  const statusInfo = shift.report ? REPORT_STATUS_LABELS[shift.report.status] : null;

  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2,
        borderRadius: 2,
        cursor: isCancelled ? 'default' : 'pointer',
        opacity: isCancelled ? 0.5 : 1,
        '&:hover': { bgcolor: isCancelled ? undefined : 'action.hover' },
        display: 'flex',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {formatDateLabel(shift.start_at)}
        </Typography>
        <Typography variant="subtitle2" fontWeight="bold" noWrap>
          {isCancelled && <Chip label="休" size="small" color="default" sx={{ mr: 1, height: 18, fontSize: '0.7rem' }} />}
          {clientName} 様
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatTimeRange(shift.start_at, shift.end_at)}
        </Typography>
      </Box>
      <Box sx={{ flexShrink: 0 }}>
        {isCancelled ? (
          <Chip label="キャンセル" size="small" color="default" variant="outlined" />
        ) : statusInfo ? (
          <Chip label={statusInfo.label} size="small" color={statusInfo.color} />
        ) : (
          <Chip label="未記録" size="small" color="default" variant="outlined" icon={<EditNoteIcon />} />
        )}
      </Box>
    </Paper>
  );
}

export default function MyShiftsPage() {
  const router = useRouter();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const calendarRef = useRef<FullCalendar>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [shifts, setShifts] = useState<MyShiftItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 月管理（YYYY-MM 形式）
  const [currentMonth, setCurrentMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const fetchShifts = useCallback(async (month: string) => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const [year, mon] = month.split('-').map(Number);
      const startDate = new Date(year, mon - 1, 1).toISOString();
      const endDate = new Date(year, mon, 1).toISOString();
      const data = await getMyShiftsWithStatus(currentOrg.id, startDate, endDate);
      setShifts(data);
    } catch (e) {
      console.error(e);
      showToast('シフトの取得に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentOrg, showToast]);

  useEffect(() => {
    if (!wsLoading && currentOrg) {
      void fetchShifts(currentMonth);
    }
  }, [wsLoading, currentOrg, currentMonth, fetchShifts]);

  const handlePrevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleShiftClick = (clientId: string, shiftId: string, isCancelled: boolean) => {
    if (isCancelled) {
      showToast('このシフトはキャンセルされています', 'info');
      return;
    }
    router.push(`/app/record/${clientId}?shiftId=${shiftId}`);
  };

  const [year, month] = currentMonth.split('-').map(Number);
  const monthLabel = `${year}年${month}月`;

  const calendarEvents = convertToCalendarEvents(shifts, true);

  if (wsLoading || !currentOrg) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ヘッダー */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, py: 2, flexShrink: 0 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" fontWeight="bold">自分のシフト</Typography>
          <ToggleButtonGroup
            size="small"
            value={viewMode}
            exclusive
            onChange={(_, v) => { if (v) setViewMode(v as ViewMode); }}
          >
            <ToggleButton value="list"><Tooltip title="リスト表示"><ListIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="calendar"><Tooltip title="カレンダー表示"><CalendarMonthIcon fontSize="small" /></Tooltip></ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* 月ナビゲーション（リストビューのみ表示。カレンダーは FullCalendar 自身の toolbar を使う） */}
        {viewMode === 'list' && (
          <Stack direction="row" alignItems="center" spacing={1} mt={1}>
            <IconButton size="small" onClick={handlePrevMonth}><ChevronLeftIcon /></IconButton>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ minWidth: 100, textAlign: 'center' }}>
              {monthLabel}
            </Typography>
            <IconButton size="small" onClick={handleNextMonth}><ChevronRightIcon /></IconButton>
          </Stack>
        )}
      </Box>

      {/* コンテンツ */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: 'background.default' }}>
        {loading ? (
          <Box display="flex" justifyContent="center" pt={8}><CircularProgress /></Box>
        ) : viewMode === 'list' ? (
          <Stack spacing={1.5} maxWidth={600} mx="auto">
            {shifts.length === 0 ? (
              <Typography color="text.secondary" textAlign="center" mt={6}>
                この月のシフトはありません
              </Typography>
            ) : (
              shifts.map(shift => (
                <ShiftListItem
                  key={shift.id}
                  shift={shift}
                  onClick={() => handleShiftClick(shift.client_id, shift.id, shift.status === 'cancelled')}
                />
              ))
            )}
          </Stack>
        ) : (
          <ShiftCalendarViewer
            ref={calendarRef}
            events={calendarEvents}
            initialView="listMonth"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'listMonth,dayGridMonth' }}
            buttonText={{ listMonth: 'リスト', dayGridMonth: '月間' }}
            noEventsText="この月のシフトはありません"
            onDatesSet={(info) => {
              const d = info.start;
              const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              setCurrentMonth(m);
            }}
            onEventClick={(info) => {
              const { clientId, shiftId, isCancelled } = info.event.extendedProps;
              handleShiftClick(clientId as string, shiftId as string, isCancelled as boolean);
            }}
          />
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: ビルドエラーがないか確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record && npx tsc --noEmit 2>&1 | head -30
```

Expected: エラーなし（または既存エラーのみ）

- [ ] **Step 3: コミット**

```bash
git add src/app/app/shifts/my/page.tsx
git commit -m "feat: add My Shifts page with list/calendar toggle"
```

---

### Task 3: サイドバーに「自分のシフト」リンクを追加

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

**Interfaces:**
- Consumes: 既存の `NavDrawer` コンポーネント内の「シフト」セクション（AppLayout.tsx:369-378行目）

- [ ] **Step 1: AppLayout.tsx の「シフト」セクションに「自分のシフト」リンクを追加する**

`src/components/layout/AppLayout.tsx` の 369〜378行目付近の「シフト」セクション：

```tsx
        <Typography sx={categoryStyle}>シフト</Typography>
        <List disablePadding>
          {/* 旧「シフト一覧(list)」と「全体シフト管理(manage)」への分岐を廃止し、統合された1つのシフトカレンダーに一本化 */}
          <ListItem disablePadding>
            <ListItemButton onClick={() => handleNav('/app/shifts/manage')} sx={itemStyle(isActive('/app/shifts/manage'))}>
              <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="シフト管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
            </ListItemButton>
          </ListItem>
        </List>
```

を以下に書き換える：

```tsx
        <Typography sx={categoryStyle}>シフト</Typography>
        <List disablePadding>
          <ListItem disablePadding>
            <ListItemButton onClick={() => handleNav('/app/shifts/my')} sx={itemStyle(isActive('/app/shifts/my'))}>
              <ListItemIcon><EditNoteIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="自分のシフト" primaryTypographyProps={{ fontSize: '0.95rem' }} />
            </ListItemButton>
          </ListItem>
          {isAdmin && (
            <ListItem disablePadding>
              <ListItemButton onClick={() => handleNav('/app/shifts/manage')} sx={itemStyle(isActive('/app/shifts/manage'))}>
                <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="シフト管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
              </ListItemButton>
            </ListItem>
          )}
        </List>
```

- [ ] **Step 2: ビルドエラーがないか確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record && npx tsc --noEmit 2>&1 | head -30
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat: add My Shifts link to sidebar"
```

---

## 動作確認チェックリスト

実装完了後、ブラウザで以下を確認する：

- [ ] サイドバーに「自分のシフト」が表示される
- [ ] 管理者は「自分のシフト」と「シフト管理」の両方が表示される
- [ ] 一般スタッフは「自分のシフト」のみ表示される
- [ ] 自分のシフト一覧で当月のシフトが表示される
- [ ] 月ナビゲーション（前月・翌月）が動作する
- [ ] リスト/カレンダー切り替えが動作する
- [ ] 記録の状態チップが正しく表示される（未記録 / 下書き / 送信済み / 承認済み / 差戻し）
- [ ] シフトをタップすると `/app/record/${clientId}?shiftId=${shiftId}` に遷移する
- [ ] 記録フォームに日時・スタッフがプリフィルされている
- [ ] キャンセル済みシフトをタップするとトーストが表示され遷移しない
