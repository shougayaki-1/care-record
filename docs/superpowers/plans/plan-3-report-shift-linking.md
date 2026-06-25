# Plan 3: Report-Shift Linking

## Global Constraints
- Working directory: /Users/shoug/Documents/GitHub/care-record
- Next.js 14 App Router, Supabase (Postgres + RLS), MUI v6, Vitest unit tests
- DB migrations: supabase/migrations/YYYYMMDDNNNN_slug.sql
- Server actions: src/app/actions/ — use getAuthedUser() + supabaseAdmin
- Auth helpers: src/utils/supabase/auth.ts — exports getAuthedUser(), assertOrgRole(), supabaseAdmin
- Record form page: src/app/app/record/[clientId]/page.tsx
- Statistics page: src/app/app/statistics/page.tsx
- reports.shift_id column has NO foreign key constraint to shifts table (intentional)
- useWorkspace() from src/context/WorkspaceContext.tsx gives currentOrg.id
- npx tsc --noEmit must show 0 errors for modified files

## Task 1: DB Migration (B1)

File: supabase/migrations/202606250003_report_shifts.sql

Create this exact file:

```sql
CREATE TABLE public.report_shifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  shift_id    uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, shift_id)
);
CREATE INDEX ON public.report_shifts (report_id);
CREATE INDEX ON public.report_shifts (shift_id);

-- Migrate existing reports.shift_id → report_shifts (primary links)
INSERT INTO public.report_shifts (report_id, shift_id, is_primary)
SELECT r.id, r.shift_id, true
FROM public.reports r
WHERE r.shift_id IS NOT NULL
  AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = r.shift_id AND s.deleted_at IS NULL)
ON CONFLICT DO NOTHING;

ALTER TABLE public.report_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Accessible via report access" ON public.report_shifts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reports rep WHERE rep.id = report_shifts.report_id AND private.can_access_client(rep.client_id)));
REVOKE INSERT, UPDATE, DELETE ON public.report_shifts FROM authenticated;
```

Apply: `npx supabase db push` from /Users/shoug/Documents/GitHub/care-record
Commit: `feat(db): add report_shifts many-to-many table, migrate existing shift_id links`

## Task 2: Server Actions (B2)

File: src/app/actions/reportShifts.ts (NEW file)

Create this exact file:

```typescript
'use server';
import { supabaseAdmin, getAuthedUser } from '@/utils/supabase/auth';

/** Returns candidate shifts to suggest linking: same client, overlapping time, not already linked. */
export async function getShiftSuggestions(
  orgId: string,
  reportId: string
): Promise<Array<{ id: string; title: string | null; start_at: string; end_at: string; staffName: string | null }>> {
  await getAuthedUser();

  // Get primary shift of the report
  const { data: primaryLink } = await supabaseAdmin
    .from('report_shifts')
    .select('shift_id, shifts(start_at, end_at, client_id)')
    .eq('report_id', reportId)
    .eq('is_primary', true)
    .maybeSingle();

  if (!primaryLink?.shift_id) return [];
  const primary = primaryLink.shifts as { start_at: string; end_at: string; client_id: string } | null;
  if (!primary) return [];

  // Get already-linked shift IDs
  const { data: existing } = await supabaseAdmin.from('report_shifts').select('shift_id').eq('report_id', reportId);
  const linkedIds = new Set((existing ?? []).map((r: { shift_id: string }) => r.shift_id));

  // Find overlapping candidate shifts
  const { data: candidates } = await supabaseAdmin
    .from('shifts')
    .select('id, title, start_at, end_at, shift_staffs(staffs(name))')
    .eq('client_id', primary.client_id)
    .neq('status', 'cancelled')
    .lt('start_at', primary.end_at)
    .gt('end_at', primary.start_at)
    .neq('id', primaryLink.shift_id)
    .is('deleted_at', null);

  return (candidates ?? [])
    .filter((c: { id: string }) => !linkedIds.has(c.id))
    .map((c: { id: string; title: string | null; start_at: string; end_at: string; shift_staffs: Array<{ staffs: { name: string } | null }> }) => ({
      id: c.id,
      title: c.title,
      start_at: c.start_at,
      end_at: c.end_at,
      staffName: c.shift_staffs?.[0]?.staffs?.name ?? null,
    }));
}

/** Links a secondary shift to a report (draft/remanded only). */
export async function addShiftLink(orgId: string, reportId: string, shiftId: string): Promise<void> {
  await getAuthedUser();

  const { data: report } = await supabaseAdmin.from('reports').select('status').eq('id', reportId).single();
  if (!report) throw new Error('記録が見つかりません');
  if (!['draft', 'remanded'].includes(report.status)) throw new Error('承認済みの記録にはシフトを追加できません');

  const { error } = await supabaseAdmin.from('report_shifts').insert({ report_id: reportId, shift_id: shiftId, is_primary: false });
  if (error) throw new Error('シフトの紐付けに失敗しました');
}

/** Removes a non-primary shift link. */
export async function removeShiftLink(orgId: string, reportId: string, shiftId: string): Promise<void> {
  await getAuthedUser();

  const { data: link } = await supabaseAdmin.from('report_shifts').select('is_primary').eq('report_id', reportId).eq('shift_id', shiftId).maybeSingle();
  if (link?.is_primary) throw new Error('主シフトは解除できません');

  const { error } = await supabaseAdmin.from('report_shifts').delete().eq('report_id', reportId).eq('shift_id', shiftId);
  if (error) throw new Error('シフトの解除に失敗しました');
}

/** Returns all shifts linked to a report. */
export async function getLinkedShifts(reportId: string) {
  const { data, error } = await supabaseAdmin
    .from('report_shifts')
    .select('shift_id, is_primary, shifts(id, title, start_at, end_at, shift_staffs(staffs(name)))')
    .eq('report_id', reportId);
  if (error) throw new Error('シフト情報を取得できませんでした');
  return data ?? [];
}
```

Commit: `feat(report-shifts): add server actions for shift suggestion and link management`

## Task 3: Record Form UI (B3)

File: src/app/app/record/[clientId]/page.tsx

Read the file first to understand current structure before making changes.

1. Add imports for the four server actions:
```typescript
import { getShiftSuggestions, addShiftLink, removeShiftLink, getLinkedShifts } from '@/app/actions/reportShifts';
```

2. Add state types and state variables alongside existing state:
```typescript
type ShiftSuggestion = { id: string; title: string | null; start_at: string; end_at: string; staffName: string | null };
type LinkedShift = { shift_id: string; is_primary: boolean; shifts: { id: string; title: string | null; start_at: string; end_at: string; shift_staffs: Array<{ staffs: { name: string } | null }> } | null };

const [shiftSuggestions, setShiftSuggestions] = useState<ShiftSuggestion[]>([]);
const [linkedShifts, setLinkedShifts] = useState<LinkedShift[]>([]);
const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
```

3. After the section where reportId and currentOrg are used, add this useEffect:
```typescript
useEffect(() => {
  if (!reportId || !currentOrg) return;
  void Promise.all([
    getLinkedShifts(reportId).then(data => setLinkedShifts(data as LinkedShift[])),
    getShiftSuggestions(currentOrg.id, reportId).then(setShiftSuggestions),
  ]);
}, [reportId, currentOrg]);
```

4. Add suggestion banners in the JSX above form fields, below any header/title. Use MUI Alert component:
```typescript
{shiftSuggestions
  .filter(s => !dismissedSuggestions.has(s.id))
  .map(suggestion => {
    const startStr = new Date(suggestion.start_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const endStr = new Date(suggestion.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    return (
      <Alert
        key={suggestion.id}
        severity="warning"
        sx={{ mb: 1 }}
        action={
          <Box display="flex" gap={1}>
            <Button size="small" onClick={async () => {
              if (!currentOrg || !reportId) return;
              await addShiftLink(currentOrg.id, reportId, suggestion.id);
              const [linked, suggestions] = await Promise.all([getLinkedShifts(reportId), getShiftSuggestions(currentOrg.id, reportId)]);
              setLinkedShifts(linked as LinkedShift[]);
              setShiftSuggestions(suggestions);
            }}>紐付ける</Button>
            <Button size="small" onClick={() => setDismissedSuggestions(prev => new Set([...prev, suggestion.id]))}>無視する</Button>
          </Box>
        }
      >
        {suggestion.staffName ?? 'スタッフ'}（{startStr}〜{endStr}）のシフトを紐付けますか？
      </Alert>
    );
  })}
```

5. Add linked shifts management section (show when linkedShifts.length > 0), placed near the suggestion banners:
```typescript
{linkedShifts.length > 0 && (
  <Box mb={2}>
    <Typography variant="subtitle2" gutterBottom>担当シフト</Typography>
    <Box display="flex" flexWrap="wrap" gap={1}>
      {linkedShifts.map(link => {
        const shift = link.shifts;
        if (!shift) return null;
        const startStr = new Date(shift.start_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const endStr = new Date(shift.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const staffName = shift.shift_staffs?.[0]?.staffs?.name ?? '';
        return (
          <Chip
            key={link.shift_id}
            label={`${staffName} ${startStr}〜${endStr}${link.is_primary ? ' [主]' : ''}`}
            onDelete={link.is_primary ? undefined : async () => {
              if (!currentOrg || !reportId) return;
              await removeShiftLink(currentOrg.id, reportId, link.shift_id);
              setLinkedShifts((await getLinkedShifts(reportId)) as LinkedShift[]);
            }}
          />
        );
      })}
    </Box>
  </Box>
)}
```

Run: `npx tsc --noEmit` — fix any type errors.
Commit: `feat(record): add shift suggestion banner and shift management section`

## Task 4: Statistics Page — Shift Variance Tab (B4)

File: src/app/app/statistics/page.tsx

Read the file first to understand current tab structure (how 'staff' and 'client' tabs are implemented).

1. Add "シフト差異" tab to existing tab group (follow same pattern as existing tabs).

2. Add query for shift variance data in the existing data-fetching block. Use same supabase client as existing queries. Find the date range variables already defined (likely shiftStartRange/shiftEndRange or similar):
```typescript
const { data: shiftsWithLinks } = await supabase
  .from('shifts')
  .select(`
    id, start_at, end_at, client_id, status,
    clients(name),
    shift_staffs(staff_id, staffs(name)),
    report_shifts(is_primary, reports(id, start_at, end_at, status))
  `)
  .eq('organization_id', currentOrg.id)
  .neq('status', 'cancelled')
  .is('deleted_at', null)
  .gte('end_at', shiftStartRange)
  .lte('start_at', shiftEndRange);
```
IMPORTANT: Check the actual variable names for date ranges in the existing code and adapt accordingly.

3. Add tab panel JSX for shift_variance tab following the same pattern as existing tab panels. Use a Table with these columns: シフト日時, 利用者名, 担当職員, 予定(h), 実績(h), 差異(h), 記録

Calculations:
- plannedH = (new Date(shift.end_at).getTime() - new Date(shift.start_at).getTime()) / 3600000
- actualMs = sum of (end_at - start_at) for linked reports where status is 'pending' or 'approved'
- actualH = actualMs > 0 ? actualMs / 3600000 : null
- diffH = actualH != null ? actualH - plannedH : null
- Display diff in red (color: 'error.main') when diffH < -0.1

Last column shows "記録を開く" Button linking to /app/record/{shift.client_id}?reportId={report.id}, or "記録なし" warning Chip if no reports linked.

Run: `npx tsc --noEmit` — fix any type errors.
Commit: `feat(statistics): add shift variance tab with planned vs actual hours`
