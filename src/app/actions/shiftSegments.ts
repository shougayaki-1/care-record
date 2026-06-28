'use server';
import { supabaseAdmin, assertShiftPermission, assertOrgRole } from '@/utils/supabase/auth';

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
  await assertOrgRole(orgId);
  const { data, error } = await supabaseAdmin
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
  if (error) throw new Error('シフト区間を取得できませんでした');
  return (data ?? []) as ShiftSegment[];
}

export async function saveShiftSegments(
  orgId: string,
  shiftId: string,
  segments: SaveSegmentInput[]
): Promise<void> {
  await assertShiftPermission(orgId, 'edit', { shiftId });

  // 既存区間を全削除してから再INSERT（シンプルで確実）
  const { error: deleteError } = await supabaseAdmin
    .from('shift_segments')
    .delete()
    .eq('shift_id', shiftId);
  if (deleteError) throw new Error('区間の保存に失敗しました');

  if (segments.length === 0) return;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('shift_segments')
    .insert(
      segments.map((s, i) => ({
        shift_id: shiftId,
        service_type_id: s.service_type_id ?? null,
        start_at: s.start_at,
        end_at: s.end_at,
        sort_order: i,
      }))
    )
    .select('id');
  if (insertError || !inserted) throw new Error('区間の保存に失敗しました');

  const staffRows = inserted.flatMap((seg, i) =>
    (segments[i].staffs ?? []).map((staff) => ({
      segment_id: seg.id,
      staff_id: staff.staff_id,
      staff_role_id: staff.staff_role_id ?? null,
    }))
  );

  if (staffRows.length > 0) {
    const { error: staffError } = await supabaseAdmin
      .from('shift_segment_staffs')
      .insert(staffRows);
    if (staffError) throw new Error('スタッフ割当の保存に失敗しました');
  }

  // Derive shift_staffs from segment staffs (shift_staffs is now a read-only denorm)
  const segmentIds = inserted.map((s) => s.id);
  let uniqueStaffIds: string[] = [];
  if (segmentIds.length > 0) {
    const { data: segStaffs } = await supabaseAdmin
      .from('shift_segment_staffs')
      .select('staff_id')
      .in('segment_id', segmentIds);
    uniqueStaffIds = [...new Set((segStaffs ?? []).map((r) => r.staff_id))];
  }
  await supabaseAdmin.from('shift_staffs').delete().eq('shift_id', shiftId);
  if (uniqueStaffIds.length > 0) {
    await supabaseAdmin.from('shift_staffs').insert(
      uniqueStaffIds.map((staff_id) => ({ shift_id: shiftId, staff_id }))
    );
  }
}

export async function deleteShiftSegment(orgId: string, segmentId: string): Promise<void> {
  const { data: seg } = await supabaseAdmin
    .from('shift_segments')
    .select('shift_id')
    .eq('id', segmentId)
    .maybeSingle();
  if (!seg) throw new Error('区間が見つかりません');
  await assertShiftPermission(orgId, 'edit', { shiftId: seg.shift_id });

  const { error } = await supabaseAdmin
    .from('shift_segments')
    .delete()
    .eq('id', segmentId);
  if (error) throw new Error('区間の削除に失敗しました');
}
