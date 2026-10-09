'use server';

import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
import type { ActionResult } from '@/types/actionResult';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';

import type { MyShiftItem } from './types';

export async function getMyShiftsWithStatus(
    organizationId: string,
    startDate: string,
    endDate: string
): Promise<ActionResult<MyShiftItem[]>> {
  return withActionResult('getMyShiftsWithStatus', async () => {
      const user = await getAuthedUser();
      const supabase = await createSessionClient();

      const { data: staffRow, error: staffError } = await supabase
          .from('staffs')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('user_id', user.id)
          .maybeSingle();

      if (staffError) throw sanitizeDbError(staffError, 'getMyShiftsWithStatus:staff', { organizationId });
      if (!staffRow) throw new ExpectedActionError('STAFF_NOT_LINKED', 'スタッフアカウントが紐付いていません。事業所設定を確認してください。');

      const { data: shifts, error } = await supabase
          .from('shifts')
          .select(`
              id,
              organization_id,
              client_id,
              title,
              start_at,
              end_at,
              status,
              cancel_reason,
              clients (id, name),
              shift_staffs!inner (staff_id, staffs (name))
          `)
          .eq('organization_id', organizationId)
          .eq('shift_staffs.staff_id', staffRow.id)
          .is('deleted_at', null)
          .lt('start_at', endDate)
          .gt('end_at', startDate)
          .order('start_at', { ascending: true });

      if (error) throw sanitizeDbError(error, 'getMyShiftsWithStatus:shifts', { organizationId });
      if (!shifts || shifts.length === 0) return [];

      const shiftIds = shifts.map(s => s.id);
      const { data: reports, error: reportsError } = await supabase
          .from('reports')
          .select('id, shift_id, status')
          .in('shift_id', shiftIds)
          .is('deleted_at', null);

      if (reportsError) throw sanitizeDbError(reportsError, 'getMyShiftsWithStatus:reports', { organizationId });

      const reportByShiftId = new Map(
          (reports ?? []).map(r => [r.shift_id, { id: r.id, status: r.status ?? 'draft' }])
      );

      return (shifts as unknown as Omit<MyShiftItem, 'report'>[]).map(shift => ({
          ...shift,
          report: reportByShiftId.get(shift.id) ?? null,
      }));
  });
}
