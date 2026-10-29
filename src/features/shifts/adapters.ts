import type { getShiftPatterns } from '@/app/actions/shifts/patterns';
import type { ShiftQueryRow } from './queries';
import type { ShiftListItem, ShiftPatternData } from './types';

type PatternQueryRow = Extract<Awaited<ReturnType<typeof getShiftPatterns>>, { ok: true }>['data'][number];

// Non-null foreign keys do not guarantee a visible joined row under RLS.
// Widen only relation values at the adapter boundary; retain every inferred column.
export type ShiftListSource = Omit<ShiftQueryRow, 'clients' | 'shift_staffs' | 'report_shifts'> & {
    clients: ShiftQueryRow['clients'] | null;
    shift_staffs: (Omit<ShiftQueryRow['shift_staffs'][number], 'staffs'> & {
        staffs: ShiftQueryRow['shift_staffs'][number]['staffs'] | null;
    })[];
    report_shifts: (Omit<ShiftQueryRow['report_shifts'][number], 'reports'> & {
        reports: ShiftQueryRow['report_shifts'][number]['reports'] | null;
    })[];
};
type PatternSegment = PatternQueryRow['shift_pattern_segments'][number];
export type ShiftPatternSource = Omit<PatternQueryRow, 'clients' | 'shift_pattern_staffs' | 'shift_pattern_segments'> & {
    clients: PatternQueryRow['clients'] | null;
    shift_pattern_staffs: (Omit<PatternQueryRow['shift_pattern_staffs'][number], 'staffs'> & {
        staffs: PatternQueryRow['shift_pattern_staffs'][number]['staffs'] | null;
    })[];
    shift_pattern_segments: (Omit<PatternSegment, 'service_type' | 'shift_pattern_segment_staffs'> & {
        service_type: PatternSegment['service_type'] | null;
        shift_pattern_segment_staffs: (Omit<PatternSegment['shift_pattern_segment_staffs'][number], 'staff' | 'staff_role'> & {
            staff: PatternSegment['shift_pattern_segment_staffs'][number]['staff'] | null;
            staff_role: PatternSegment['shift_pattern_segment_staffs'][number]['staff_role'] | null;
        })[];
    })[];
};

/** Preserve nullable relations and omit report links whose target is missing or deleted. */
export function toShiftListItem(shift: ShiftListSource) {
    const { shift_segments, staff_filter, segment_filter, ...listShift } = shift as ShiftListSource & {
        staff_filter?: unknown; segment_filter?: unknown;
    };
    void shift_segments; void staff_filter; void segment_filter;
    return {
        ...listShift,
        clients: shift.clients,
        shift_staffs: shift.shift_staffs.map(staff => ({ staff_id: staff.staff_id, staffs: staff.staffs })),
        report_statuses: shift.report_shifts.flatMap(link => {
            const report = link.reports;
            if (!report || report.deleted_at) return [];
            return [{ id: report.id, status: report.status, is_primary: link.is_primary }];
        }),
    } satisfies ShiftListItem;
}

/** Keep the modal's segment/staff structure explicit at the query-to-screen boundary. */
export function toShiftPatternData(pattern: ShiftPatternSource): ShiftPatternData {
    return {
        id: pattern.id,
        client_id: pattern.client_id,
        title: pattern.title,
        start_time: pattern.start_time,
        end_time: pattern.end_time,
        rrule: pattern.rrule,
        clients: pattern.clients,
        shift_pattern_staffs: pattern.shift_pattern_staffs.map(staff => ({ staff_id: staff.staff_id, staffs: staff.staffs })),
        shift_pattern_segments: pattern.shift_pattern_segments.map(segment => ({
            id: segment.id,
            service_type_id: segment.service_type_id,
            start_time: segment.start_time,
            end_time: segment.end_time,
            sort_order: segment.sort_order,
            service_type: segment.service_type,
            shift_pattern_segment_staffs: segment.shift_pattern_segment_staffs.map(staff => ({
                staff_id: staff.staff_id,
                staff_role_id: staff.staff_role_id,
                staff: staff.staff,
                staff_role: staff.staff_role,
            })),
        })),
    };
}
