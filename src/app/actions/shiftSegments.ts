'use server';
import { sanitizeDbError, withSafeError } from '@/utils/errors';
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

export async function getShiftSegments(orgId: string, shiftId: string): Promise<ShiftSegment[]> {
  return withSafeError('getShiftSegments', async () => {
    await assertOrgRole(orgId);
    const supabase = await createSessionClient();
    const { data: shift, error: shiftError } = await supabase
      .from('shifts')
      .select('id')
      .eq('id', shiftId)
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (shiftError || !shift) throw new Error('シフトにアクセスできません');
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
): Promise<void> {
  return withSafeError('saveShiftSegments', async () => {
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

export async function deleteShiftSegment(orgId: string, segmentId: string): Promise<void> {
  return withSafeError('deleteShiftSegment', async () => {
    const supabase = await createSessionClient();
    const { data: seg } = await supabase
      .from('shift_segments')
      .select('shift_id')
      .eq('id', segmentId)
      .maybeSingle();
    if (!seg) throw new Error('区間が見つかりません');
    await assertShiftPermission(orgId, 'edit', { shiftId: seg.shift_id });

    const { error } = await supabase.rpc('delete_shift_segment_atomic', {
      p_org_id: orgId,
      p_segment_id: segmentId,
    });
    if (error) throw sanitizeDbError(error, 'deleteShiftSegment');
  });
}
