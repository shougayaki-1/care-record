import type { Database } from '@/types/database.generated';

export type ClientData = Pick<Database['public']['Tables']['clients']['Row'], 'id' | 'name'>;
export type StaffData = Pick<Database['public']['Tables']['staffs']['Row'], 'id' | 'name'>;

type Row<Table extends keyof Database['public']['Tables']> = Database['public']['Tables'][Table]['Row'];
type NamedStaff = Pick<Row<'staffs'>, 'name'>;

export type ShiftData = Pick<Row<'shifts'>,
    'id' | 'client_id' | 'title' | 'start_at' | 'end_at' | 'status' | 'cancel_reason'
> & { shift_staffs: Pick<Row<'shift_staffs'>, 'staff_id'>[] };

export type ShiftReportStatus = Pick<Row<'reports'>, 'id' | 'status'> & Pick<Row<'report_shifts'>, 'is_primary'>;

export type ShiftListItem = Omit<ShiftData, 'shift_staffs'> & Pick<Row<'shifts'>, 'organization_id'> & {
    clients: ClientData | null;
    shift_staffs: (Pick<Row<'shift_staffs'>, 'staff_id'> & { staffs: NamedStaff | null })[];
    report_statuses?: ShiftReportStatus[];
};

export type ShiftPatternSegmentData = Pick<Row<'shift_pattern_segments'>,
    'id' | 'service_type_id' | 'start_time' | 'end_time' | 'sort_order'
> & {
    service_type?: Pick<Row<'service_types'>, 'id' | 'name'> | null;
    shift_pattern_segment_staffs: (Pick<Row<'shift_pattern_segment_staffs'>, 'staff_id' | 'staff_role_id'> & {
        staff?: StaffData | null;
        staff_role?: Pick<Row<'staff_roles'>, 'id' | 'name' | 'is_unpaid'> | null;
    })[];
};

export type ShiftPatternData = Pick<Row<'shift_patterns'>,
    'id' | 'client_id' | 'title' | 'start_time' | 'end_time' | 'rrule'
> & {
    clients: Pick<Row<'clients'>, 'name'> | null;
    shift_pattern_staffs: (Pick<Row<'shift_pattern_staffs'>, 'staff_id'> & { staffs: NamedStaff | null })[];
    shift_pattern_segments?: ShiftPatternSegmentData[];
};

export type ShiftPatternFormData = Omit<ShiftPatternData,
    'clients' | 'shift_pattern_staffs' | 'shift_pattern_segments'
> & {
    shift_pattern_staffs: Pick<Row<'shift_pattern_staffs'>, 'staff_id'>[];
    shift_pattern_segments?: (Omit<ShiftPatternSegmentData, 'shift_pattern_segment_staffs'> & {
        shift_pattern_segment_staffs: Pick<Row<'shift_pattern_segment_staffs'>, 'staff_id' | 'staff_role_id'>[];
    })[];
};
