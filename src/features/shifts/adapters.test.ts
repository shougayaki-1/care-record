import { describe, expect, it } from 'vitest';
import { toShiftListItem, toShiftPatternData } from './adapters';
import { convertToCalendarEvents } from '@/utils/shiftHelper';
import type { ShiftListSource } from './adapters';

const shift: ShiftListSource = {
    id: 'shift', organization_id: 'org', client_id: 'client', title: null,
    start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-01T02:00:00Z',
    status: null, cancel_reason: null, clients: null, shift_staffs: [], shift_segments: [], report_shifts: [],
};
const pattern: Parameters<typeof toShiftPatternData>[0] = {
    id: 'pattern', client_id: 'client', title: null, start_time: '09:00:00', end_time: '12:00:00',
    rrule: 'FREQ=WEEKLY;BYDAY=MO', clients: null, shift_pattern_staffs: [], shift_pattern_segments: [],
};

describe('shift query adapters', () => {
    it('preserves null relations, nullable scalars and empty staff lists through calendar conversion', () => {
        const result = toShiftListItem(shift);
        const { shift_segments: _segments, ...expected } = shift;
        void _segments;
        expect(result).toEqual({ ...expected, report_statuses: [] });
        const event = convertToCalendarEvents([result])[0];
        expect(event).toMatchObject({ title: '予定 様', start: shift.start_at, end: shift.end_at,
            extendedProps: { clientName: '', staffNames: '', reportStatuses: [], shiftData: result } });
    });

    it('excludes missing and deleted reports while keeping all live statuses and primary flags', () => {
        const result = toShiftListItem({ ...shift, clients: { id: 'client', name: '利用者' },
            shift_staffs: [{ staff_id: 'missing', staffs: null }, { staff_id: 'staff', staffs: { name: 'スタッフ' } }],
            report_shifts: [
                { shift_id: 'shift', is_primary: false, reports: null },
                { shift_id: 'shift', is_primary: true, reports: { id: 'deleted', status: 'approved', deleted_at: '2026-10-02' } },
                { shift_id: 'shift', is_primary: true, reports: { id: 'live', status: 'pending', deleted_at: null } },
                { shift_id: 'shift', is_primary: false, reports: { id: 'unknown', status: null, deleted_at: null } },
            ],
        });
        expect(result.report_statuses).toEqual([
            { id: 'live', status: 'pending', is_primary: true },
            { id: 'unknown', status: null, is_primary: false },
        ]);
        expect(convertToCalendarEvents([result])[0].extendedProps).toMatchObject({ staffNames: 'スタッフ', clientName: '利用者' });
    });

    it('keeps empty pattern relations and staff lists', () => {
        expect(toShiftPatternData(pattern)).toEqual(pattern);
    });

    it('preserves multiple segments, their order, optional roles and missing staff relations', () => {
        const input: typeof pattern = { ...pattern,
            shift_pattern_staffs: [{ staff_id: 'staff', staffs: null }],
            shift_pattern_segments: [
                { id: 'second', service_type_id: null, start_time: '10:00:00', end_time: '12:00:00', sort_order: 1,
                    service_type: null, shift_pattern_segment_staffs: [
                        { staff_id: 'missing', staff_role_id: null, staff: null, staff_role: null },
                    ] },
                { id: 'first', service_type_id: 'service', start_time: '09:00:00', end_time: '10:00:00', sort_order: 0,
                    service_type: { id: 'service', name: '身体介護' }, shift_pattern_segment_staffs: [
                        { staff_id: 'staff', staff_role_id: 'role', staff: { id: 'staff', name: 'スタッフ' },
                            staff_role: { id: 'role', name: '同行', is_unpaid: true } },
                    ] },
            ],
        };
        expect(toShiftPatternData(input)).toEqual(input);
        expect(input.shift_pattern_segments.map(segment => segment.id)).toEqual(['second', 'first']);
    });
});
