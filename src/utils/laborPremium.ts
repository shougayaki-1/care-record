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
