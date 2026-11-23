export type ImportShift = { id: string; start_at: string; end_at: string; status: string };

/** Filter only visible shifts returned by the authorized DB RPC; never choose a match. */
export function matchImportShifts(shifts: ImportShift[], start: number, end: number): ImportShift[] {
  return shifts.filter(shift => shift.status !== 'cancelled' && Date.parse(shift.start_at) < end && Date.parse(shift.end_at) > start)
    .map(shift => ({ id: shift.id, start_at: shift.start_at, end_at: shift.end_at, status: shift.status }));
}

export function japanBusinessDate(value: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
