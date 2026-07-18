import 'server-only';

import type { ShiftPatternPayload, ShiftPatternSegmentInput } from './types';

export function normalizeTimeForDb(time: string): string {
  if (!time) return time;
  return time.length === 5 ? `${time}:00` : time;
}

export function uniqueStaffIdsFromSegments(
  segments: Array<{ staffs?: Array<{ staff_id: string }> }> | undefined,
): string[] {
  const ids = new Set<string>();
  for (const segment of segments ?? []) {
    for (const staff of segment.staffs ?? []) {
      if (staff.staff_id) ids.add(staff.staff_id);
    }
  }
  return Array.from(ids);
}

export function normalizePatternSegments(payload: ShiftPatternPayload): ShiftPatternSegmentInput[] {
  const inputSegments = (payload.segments ?? [])
    .filter((segment) => segment.start_time && segment.end_time);
  return inputSegments.map((segment, index) => ({
    service_type_id: segment.service_type_id || null,
    start_time: normalizeTimeForDb(segment.start_time),
    end_time: normalizeTimeForDb(segment.end_time),
    sort_order: index,
    staffs: (segment.staffs ?? [])
      .filter((staff) => Boolean(staff.staff_id))
      .map((staff) => ({
        staff_id: staff.staff_id,
        staff_role_id: staff.staff_role_id || null,
      })),
  }));
}
