import type { QueryData, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';

// Keep both projections literal so Supabase checks relations and selected columns.
export function createShiftListQuery(client: SupabaseClient<Database>, staffFiltered: boolean) {
    const columns = `
              id,
              organization_id,
              client_id,
              title,
              start_at,
              end_at,
              status,
              cancel_reason,
              shift_segments (shift_segment_staffs (staff_id)),
              clients (id, name),
              report_shifts (shift_id, is_primary, reports (id, status, deleted_at))`;
    return staffFiltered
        ? client.from('shifts').select(`${columns}, shift_staffs (staff_id, staffs (name)), staff_filter:shift_staffs (), segment_filter:shift_segments (shift_segment_staffs!inner (staff_id))`)
        : client.from('shifts').select(`${columns}, shift_staffs (staff_id, staffs (name))`);
}

export type ShiftQueryRow = QueryData<ReturnType<typeof createShiftListQuery>>[number];
