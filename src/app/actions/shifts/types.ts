import type { SaveSegmentInput } from '../shiftSegments';

export type ShiftPayload = {
  organizationId: string;
  clientId: string;
  title: string;
  startAt: string;
  endAt: string;
  segments?: SaveSegmentInput[];
  status?: 'published' | 'cancelled';
  cancelReason?: string;
  patternId?: string;
  isModified?: boolean;
  autoAssign?: boolean;
};

export type ShiftPatternPayload = {
  organizationId: string;
  clientId: string;
  title: string;
  startTime: string;
  endTime: string;
  rrule: string;
  segments?: ShiftPatternSegmentInput[];
  autoAssign?: boolean;
};

export type ShiftPatternSegmentStaffInput = {
  staff_id: string;
  staff_role_id?: string | null;
};

export type ShiftPatternSegmentInput = {
  service_type_id?: string | null;
  start_time: string;
  end_time: string;
  sort_order?: number;
  staffs: ShiftPatternSegmentStaffInput[];
};

export type ShiftQueryFilter = {
  staffId?: string;
  clientId?: string;
};

export type RepairGoogleCalendarSyncOptions = {
  limit?: number;
};

export type MyShiftItem = {
  id: string;
  organization_id: string;
  client_id: string;
  title: string | null;
  start_at: string;
  end_at: string;
  status: string;
  cancel_reason: string | null;
  clients: { id: string; name: string } | null;
  shift_staffs: Array<{ staff_id: string; staffs: { name: string } | null }>;
  report: { id: string; status: string } | null;
};
