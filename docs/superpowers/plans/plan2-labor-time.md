# Plan 2: Labor Time Management

## Global Constraints
- Next.js 14 App Router, Supabase (Postgres + RLS), MUI v6, Vitest unit tests
- DB migrations: `supabase/migrations/YYYYMMDDNNNN_slug.sql`
- Server actions: `src/app/actions/` — use `getAuthedUser()` + `supabaseAdmin`
- Auth helpers: `src/utils/supabase/auth.ts` — exports `getAuthedUser()`, `assertOrgRole()`, `supabaseAdmin`
- Settings page: `src/app/app/settings/page.tsx`
- Statistics page: `src/app/app/statistics/page.tsx`
- `useWorkspace()` hook from `src/context/WorkspaceContext.tsx` gives `currentOrg.id`
- Use `assertOrgRole(orgId, ['owner', 'manager'])` for permission checks

## Task A1: DB Migration

File: `supabase/migrations/202606250002_labor_premium_types.sql`

```sql
CREATE TABLE public.labor_premium_types (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                              text NOT NULL,
  display_order                     int NOT NULL DEFAULT 0,
  is_enabled                        boolean NOT NULL DEFAULT true,
  rate                              numeric(5,4) NOT NULL,
  calc_method                       text NOT NULL CHECK (calc_method IN ('additive', 'multiplicative')),
  builtin_type                      text CHECK (builtin_type IN ('night', 'overtime', 'custom')),
  night_start_hour                  smallint CHECK (night_start_hour BETWEEN 0 AND 23),
  night_end_hour                    smallint CHECK (night_end_hour BETWEEN 0 AND 23),
  overtime_daily_threshold_hours    numeric(4,2),
  overtime_weekly_threshold_hours   numeric(4,2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.labor_premium_types (organization_id, display_order);

-- Seed defaults for existing orgs
INSERT INTO public.labor_premium_types (organization_id, name, display_order, rate, calc_method, builtin_type, night_start_hour, night_end_hour)
SELECT id, '深夜割り増し', 0, 0.25, 'additive', 'night', 22, 5 FROM public.organizations;

INSERT INTO public.labor_premium_types (organization_id, name, display_order, rate, calc_method, builtin_type, overtime_daily_threshold_hours, overtime_weekly_threshold_hours)
SELECT id, '時間外割り増し', 1, 0.25, 'multiplicative', 'overtime', 8.0, 40.0 FROM public.organizations;

ALTER TABLE public.labor_premium_types ENABLE ROW LEVEL SECURITY;

-- is_org_member function exists in private schema
CREATE POLICY "Org members read premium types" ON public.labor_premium_types FOR SELECT USING (private.is_org_member(organization_id));
REVOKE INSERT, UPDATE, DELETE ON public.labor_premium_types FROM authenticated;
```

Apply: `npx supabase db push`
Commit: `feat(db): add labor_premium_types table with night/overtime defaults`

## Task A2: Calculation Logic + Tests

Create `src/utils/laborPremium.ts`:

```typescript
export type LaborPremiumType = {
  id: string;
  name: string;
  is_enabled: boolean;
  rate: number;
  calc_method: 'additive' | 'multiplicative';
  builtin_type: 'night' | 'overtime' | 'custom' | null;
  night_start_hour: number | null;
  night_end_hour: number | null;
  overtime_daily_threshold_hours: number | null;
  overtime_weekly_threshold_hours: number | null;
};

/** Count minutes of [start, end) interval that fall inside a time window.
 *  If nightStartHour > nightEndHour, the window crosses midnight (e.g. 22–5). */
export function getNightMinutes(
  start: Date, end: Date,
  nightStartHour: number, nightEndHour: number
): number {
  let minutes = 0;
  const cur = new Date(start);
  while (cur < end) {
    const h = cur.getHours();
    const inWindow = nightStartHour > nightEndHour
      ? (h >= nightStartHour || h < nightEndHour)
      : (h >= nightStartHour && h < nightEndHour);
    if (inWindow) minutes++;
    cur.setMinutes(cur.getMinutes() + 1);
  }
  return minutes;
}

type Slot = { start: Date; end: Date };

/** Returns total overtime minutes given all slots for the day (and optionally the week). */
export function getOvertimeMinutes(
  slotsForDay: Slot[],
  dailyThresholdHours: number | null,
  weeklyThresholdHours: number | null,
  allWeekSlots?: Slot[]
): number {
  let overtimeMinutes = 0;
  if (dailyThresholdHours != null) {
    const dailyMin = slotsForDay.reduce((s, sl) => s + (sl.end.getTime() - sl.start.getTime()) / 60000, 0);
    const thresh = dailyThresholdHours * 60;
    if (dailyMin > thresh) overtimeMinutes = Math.max(overtimeMinutes, dailyMin - thresh);
  }
  if (weeklyThresholdHours != null && allWeekSlots) {
    const weekMin = allWeekSlots.reduce((s, sl) => s + (sl.end.getTime() - sl.start.getTime()) / 60000, 0);
    const thresh = weeklyThresholdHours * 60;
    if (weekMin > thresh) overtimeMinutes = Math.max(overtimeMinutes, weekMin - thresh);
  }
  return Math.round(overtimeMinutes);
}

export function calcPremiumMinutesByType(
  type: LaborPremiumType,
  shiftStart: Date, shiftEnd: Date,
  slotsForDay: Slot[],
  allWeekSlots?: Slot[]
): number {
  if (!type.is_enabled) return 0;
  if (type.builtin_type === 'night' || type.builtin_type === 'custom') {
    if (type.night_start_hour == null || type.night_end_hour == null) return 0;
    return getNightMinutes(shiftStart, shiftEnd, type.night_start_hour, type.night_end_hour);
  }
  if (type.builtin_type === 'overtime') {
    return getOvertimeMinutes(slotsForDay, type.overtime_daily_threshold_hours, type.overtime_weekly_threshold_hours, allWeekSlots);
  }
  return 0;
}

function getISOWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Aggregate premium minutes per type.id for a list of actual shifts (reports). */
export function aggregatePremiumMinutes(
  types: LaborPremiumType[],
  shifts: Array<{ start_at: string; end_at: string }>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const type of types) result[type.id] = 0;

  const daySlots: Record<string, Slot[]> = {};
  const weekSlots: Record<string, Slot[]> = {};
  for (const s of shifts) {
    const start = new Date(s.start_at), end = new Date(s.end_at);
    const dk = start.toISOString().slice(0, 10);
    const wk = getISOWeekKey(start);
    (daySlots[dk] ??= []).push({ start, end });
    (weekSlots[wk] ??= []).push({ start, end });
  }

  for (const s of shifts) {
    const start = new Date(s.start_at), end = new Date(s.end_at);
    const dk = start.toISOString().slice(0, 10);
    const wk = getISOWeekKey(start);
    for (const type of types) {
      result[type.id] += calcPremiumMinutesByType(type, start, end, daySlots[dk] ?? [], weekSlots[wk]);
    }
  }
  return result;
}
```

Create `src/utils/laborPremium.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getNightMinutes, getOvertimeMinutes, calcPremiumMinutesByType, type LaborPremiumType } from './laborPremium';

const nightType: LaborPremiumType = { id: '1', name: '深夜', is_enabled: true, rate: 0.25, calc_method: 'additive', builtin_type: 'night', night_start_hour: 22, night_end_hour: 5, overtime_daily_threshold_hours: null, overtime_weekly_threshold_hours: null };
const overtimeType: LaborPremiumType = { id: '2', name: '時間外', is_enabled: true, rate: 0.25, calc_method: 'multiplicative', builtin_type: 'overtime', night_start_hour: null, night_end_hour: null, overtime_daily_threshold_hours: 8, overtime_weekly_threshold_hours: 40 };

describe('getNightMinutes', () => {
  it('counts minutes in 22:00-01:00 (crosses midnight)', () => {
    expect(getNightMinutes(new Date('2026-01-01T22:00:00'), new Date('2026-01-02T01:00:00'), 22, 5)).toBe(180);
  });
  it('counts no minutes for daytime shift', () => {
    expect(getNightMinutes(new Date('2026-01-01T09:00:00'), new Date('2026-01-01T17:00:00'), 22, 5)).toBe(0);
  });
});

describe('getOvertimeMinutes', () => {
  it('returns 0 when shift is within daily threshold', () => {
    const slots = [{ start: new Date('2026-01-01T09:00:00'), end: new Date('2026-01-01T16:00:00') }];
    expect(getOvertimeMinutes(slots, 8, null)).toBe(0);
  });
  it('returns excess minutes above daily threshold', () => {
    const slots = [{ start: new Date('2026-01-01T08:00:00'), end: new Date('2026-01-01T18:00:00') }];
    expect(getOvertimeMinutes(slots, 8, null)).toBe(120);
  });
});
```

Run: `npx vitest run src/utils/laborPremium.test.ts` — all must pass.
Commit: `feat(labor): add premium time calculation logic with tests`

## Task A3: Server Actions + Settings UI

Create `src/app/actions/laborPremium.ts`:

```typescript
'use server';
import { supabaseAdmin, assertOrgRole } from '@/utils/supabase/auth';

export async function getLaborPremiumTypes(orgId: string) {
  await assertOrgRole(orgId); // any member can read
  const { data, error } = await supabaseAdmin.from('labor_premium_types').select('*').eq('organization_id', orgId).order('display_order');
  if (error) throw new Error('労働時間ルールを取得できませんでした');
  return data ?? [];
}

export async function updateLaborPremiumType(
  orgId: string, typeId: string,
  patch: { name?: string; rate?: number; calc_method?: 'additive' | 'multiplicative'; is_enabled?: boolean; night_start_hour?: number | null; night_end_hour?: number | null; overtime_daily_threshold_hours?: number | null; overtime_weekly_threshold_hours?: number | null }
): Promise<void> {
  await assertOrgRole(orgId, ['owner', 'manager']);
  const { error } = await supabaseAdmin.from('labor_premium_types').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', typeId).eq('organization_id', orgId);
  if (error) throw new Error('更新に失敗しました');
}

export async function createLaborPremiumType(
  orgId: string,
  data: { name: string; rate: number; calc_method: 'additive' | 'multiplicative'; night_start_hour: number; night_end_hour: number }
): Promise<void> {
  await assertOrgRole(orgId, ['owner', 'manager']);
  const { data: last } = await supabaseAdmin.from('labor_premium_types').select('display_order').eq('organization_id', orgId).order('display_order', { ascending: false }).limit(1).maybeSingle();
  const nextOrder = (last?.display_order ?? 0) + 1;
  const { error } = await supabaseAdmin.from('labor_premium_types').insert({ organization_id: orgId, display_order: nextOrder, builtin_type: 'custom', ...data });
  if (error) throw new Error('追加に失敗しました');
}

export async function disableLaborPremiumType(orgId: string, typeId: string): Promise<void> {
  await assertOrgRole(orgId, ['owner', 'manager']);
  await supabaseAdmin.from('labor_premium_types').update({ is_enabled: false, updated_at: new Date().toISOString() }).eq('id', typeId).eq('organization_id', orgId);
}
```

Create `src/components/settings/LaborPremiumSettings.tsx` — a client component that:
1. Accepts `orgId: string` prop
2. Fetches types on mount via `getLaborPremiumTypes(orgId)`
3. Renders a list: each row shows name, rate%, calc_method, and edit/disable buttons
4. Edit button opens a MUI Dialog with:
   - TextField for name
   - NumberField for rate (shown as %)
   - Select for calc_method (加算/乗算)
   - For 'night'/'custom' type: start/end hour number inputs
   - For 'overtime' type: daily/weekly threshold number inputs
5. "種別を追加" button for custom types (builtin_type='custom')
6. Toggle (chip or switch) for enable/disable
7. Use `updateLaborPremiumType()`, `createLaborPremiumType()`, `disableLaborPremiumType()`

Add to `src/app/app/settings/page.tsx`: Read the file first to understand current sections, then add the `LaborPremiumSettings` component in an appropriate section. Only show it to users with manager or owner access. Use `currentOrg?.role` and `useWorkspace()`.

Commit: `feat(labor): settings UI for premium time rules`

## Task A4: Statistics Page Update

File: `src/app/app/statistics/page.tsx`

Read the file first to understand current structure. Then add:

1. Import the new calculation utility:
```typescript
import { aggregatePremiumMinutes, type LaborPremiumType } from '@/utils/laborPremium';
```

2. Fetch premium types (add to existing data fetch block, alongside shifts/reports):
```typescript
const { data: rawPremiumTypes } = await supabase
  .from('labor_premium_types')
  .select('*')
  .eq('organization_id', currentOrg.id)
  .eq('is_enabled', true)
  .order('display_order');
const premiumTypes = (rawPremiumTypes ?? []) as LaborPremiumType[];
```

3. In the staff tab aggregation loop, for each staff's actual shifts/reports:
```typescript
const staffActualShifts = /* actual reports for this staff */.map(r => ({ start_at: r.start_at, end_at: r.end_at }));
const premiumMins = aggregatePremiumMinutes(premiumTypes, staffActualShifts);
```

4. Add columns to the staff tab table:
   - In `<TableHead>`: add `{premiumTypes.map(t => <TableCell key={t.id} align="right">{t.name}(h)</TableCell>)}`
   - In each `<TableRow>`: add `{premiumTypes.map(t => <TableCell key={t.id} align="right">{((premiumMins[t.id] ?? 0) / 60).toFixed(1)}</TableCell>)}`

5. Add columns to CSV export:
```typescript
const csvHeaders = ['氏名', '予定時間(h)', '実績時間(h)', '差異(h)', ...premiumTypes.map(t => `${t.name}(h)`)];
```

Run: `npx tsc --noEmit` — fix any type errors.
Commit: `feat(statistics): add premium time columns to staff tab`
