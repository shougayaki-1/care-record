'use server';
import type { ActionResult } from '@/types/actionResult';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
import { createSessionClient, assertShiftPermission, assertOrgRole } from '@/utils/supabase/auth';

export type ShiftSegmentStaff = {
  id: string;
  segment_id: string;
  staff_id: string;
  staff_role_id: string | null;
  staff_role?: { id: string; name: string; is_unpaid: boolean } | null;
  staff?: { id: string; name: string } | null;
};

export type ShiftSegment = {
  id: string;
  shift_id: string;
  service_type_id: string | null;
  service_type?: { id: string; name: string } | null;
  start_at: string;
  end_at: string;
  sort_order: number;
  shift_segment_staffs: ShiftSegmentStaff[];
};

export type SaveSegmentInput = {
  id?: string;
  service_type_id?: string | null;
  start_at: string;
  end_at: string;
  sort_order: number;
  staffs: { staff_id: string; staff_role_id?: string | null }[];
};

export async function getShiftSegments(orgId: string, shiftId: string): Promise<ActionResult<ShiftSegment[]>> {
  return withActionResult('getShiftSegments', async () => {
    await assertOrgRole(orgId);
    const supabase = await createSessionClient();
    const { data: shift, error: shiftError } = await supabase
      .from('shifts')
      .select('id')
      .eq('id', shiftId)
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (shiftError) throw sanitizeDbError(shiftError, 'getShiftSegments:shift');
    if (!shift) throw new ExpectedActionError('NOT_FOUND', 'シフトにアクセスできません');
    const { data, error } = await supabase
      .from('shift_segments')
      .select(`
        *,
        service_type:service_types(id, name),
        shift_segment_staffs(
          *,
          staff:staffs(id, name),
          staff_role:staff_roles(id, name, is_unpaid)
        )
      `)
      .eq('shift_id', shiftId)
      .order('sort_order');
    if (error) throw sanitizeDbError(error, 'getShiftSegments');
    return (data ?? []) as ShiftSegment[];
  });
}

export async function saveShiftSegments(
  orgId: string,
  shiftId: string,
  segments: SaveSegmentInput[]
): Promise<ActionResult<void>> {
  return withActionResult('saveShiftSegments', async () => {
    await assertShiftPermission(orgId, 'edit', { shiftId });
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('replace_shift_segments', {
      p_org_id: orgId,
      p_shift_id: shiftId,
      p_segments: segments,
    });
    if (error) throw sanitizeDbError(error, 'saveShiftSegments');
  });
}
