import { describe, expect, it } from 'vitest';

import { normalizePatternSegments, normalizeTimeForDb, uniqueStaffIdsFromSegments } from './helpers';

describe('shift helpers', () => {
  it('normalizes HH:mm values while preserving seconds and empty values', () => {
    expect(normalizeTimeForDb('09:30')).toBe('09:30:00');
    expect(normalizeTimeForDb('09:30:15')).toBe('09:30:15');
    expect(normalizeTimeForDb('')).toBe('');
  });

  it('collects unique non-empty staff IDs in first-seen order', () => {
    expect(uniqueStaffIdsFromSegments([
      { staffs: [{ staff_id: 'staff-b' }, { staff_id: 'staff-a' }] },
      { staffs: [{ staff_id: 'staff-b' }, { staff_id: '' }] },
    ])).toEqual(['staff-b', 'staff-a']);
    expect(uniqueStaffIdsFromSegments(undefined)).toEqual([]);
  });

  it('drops incomplete segments and normalizes segment order, times, and staff values', () => {
    expect(normalizePatternSegments({
      organizationId: 'org-1',
      clientId: 'client-1',
      title: '訪問',
      startTime: '09:00',
      endTime: '10:00',
      rrule: 'FREQ=WEEKLY',
      segments: [{
        service_type_id: '',
        start_time: '09:00',
        end_time: '09:30',
        sort_order: 99,
        staffs: [
          { staff_id: 'staff-1', staff_role_id: '' },
          { staff_id: '' },
        ],
      }, {
        start_time: '',
        end_time: '10:00',
        staffs: [],
      }],
    })).toEqual([{
      service_type_id: null,
      start_time: '09:00:00',
      end_time: '09:30:00',
      sort_order: 0,
      staffs: [{ staff_id: 'staff-1', staff_role_id: null }],
    }]);
  });
});
