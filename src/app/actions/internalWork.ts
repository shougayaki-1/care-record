'use server';

import { sanitizeDbError } from '@/utils/errors';
import { assertOrgRole, assertOrgPermission, getAuthedUser, supabaseAdmin } from '@/utils/supabase/auth';

export type InternalWorkStatus = 'pending' | 'approved' | 'remanded';

export type InternalWorkRecord = {
  id: string;
  organization_id: string;
  staff_id: string;
  title: string;
  work_type: string;
  start_at: string;
  end_at: string;
  work_hours: number;
  status: InternalWorkStatus;
  note: string | null;
  staffs: { name: string } | null;
};

export type SaveInternalWorkInput = {
  organizationId: string;
  title: string;
  workType: string;
  startAt: string;
  endAt: string;
  workHours: number;
  note?: string;
};

async function getMyStaffId(organizationId: string, userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('staffs')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw sanitizeDbError(error, 'action.internalWork');
  if (!data?.id) throw new Error('ログイン中のアカウントに紐づくスタッフが見つかりません');
  return data.id;
}

export async function saveInternalWork(input: SaveInternalWorkInput) {
  const { userId } = await assertOrgRole(input.organizationId);
  const staffId = await getMyStaffId(input.organizationId, userId);

  const title = input.title.trim();
  const workType = input.workType.trim() || 'meeting';
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const workHours = Number(input.workHours);

  if (!title || title.length > 100) throw new Error('件名を1〜100文字で入力してください');
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
    throw new Error('開始・終了日時が不正です');
  }
  if (!Number.isFinite(workHours) || workHours <= 0 || workHours > 24) {
    throw new Error('内勤時間を0より大きく24以下で入力してください');
  }

  const { data, error } = await supabaseAdmin
    .from('internal_work_records')
    .insert({
      organization_id: input.organizationId,
      staff_id: staffId,
      recorded_by: userId,
      title,
      work_type: workType,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      work_hours: workHours,
      status: 'pending',
      note: input.note?.trim() || null,
    })
    .select('id')
    .single();

  if (error || !data) throw sanitizeDbError(error || new Error('内勤実績を保存できませんでした'), 'action.internalWork');
  return { success: true, id: data.id as string };
}

export async function listMyInternalWorkRecords(
  organizationId: string,
  startAt: string,
  endAt: string,
): Promise<InternalWorkRecord[]> {
  const user = await getAuthedUser();
  await assertOrgRole(organizationId);
  const staffId = await getMyStaffId(organizationId, user.id);

  const { data, error } = await supabaseAdmin
    .from('internal_work_records')
    .select('id, organization_id, staff_id, title, work_type, start_at, end_at, work_hours, status, note, staffs(name)')
    .eq('organization_id', organizationId)
    .eq('staff_id', staffId)
    .is('deleted_at', null)
    .gte('end_at', startAt)
    .lte('start_at', endAt)
    .order('start_at', { ascending: false });

  if (error) throw sanitizeDbError(error, 'action.internalWork');
  return (data ?? []) as unknown as InternalWorkRecord[];
}

export async function listInternalWorkRecordsForStatistics(
  organizationId: string,
  startAt: string,
  endAt: string,
): Promise<InternalWorkRecord[]> {
  await assertOrgPermission(organizationId, 'reports');

  const { data, error } = await supabaseAdmin
    .from('internal_work_records')
    .select('id, organization_id, staff_id, title, work_type, start_at, end_at, work_hours, status, note, staffs(name)')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .gte('end_at', startAt)
    .lte('start_at', endAt)
    .order('start_at', { ascending: true });

  if (error) throw sanitizeDbError(error, 'action.internalWork');
  return (data ?? []) as unknown as InternalWorkRecord[];
}
