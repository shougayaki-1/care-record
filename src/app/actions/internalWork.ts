'use server';
import type { ActionResult } from '@/types/actionResult';

import { requireActionResult, withActionResult, sanitizeDbError, ExpectedActionError } from '@/utils/errors';
import { assertOrgRole, assertOrgPermission, createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { asJsonRecord } from '@/types/json';
import type { InternalWorkAction } from '@/utils/permissions';
import { normalizePermissions } from '@/utils/permissions';

export type InternalWorkStatus = 'pending' | 'approved' | 'remanded';

export type InternalWorkRecord = {
  id: string;
  organization_id: string;
  staff_id: string;
  recorded_by?: string;
  title: string;
  work_type: string;
  start_at: string;
  end_at: string;
  work_hours: number;
  status: InternalWorkStatus;
  note: string | null;
  staffs: { name: string } | null;
};

export type InternalWorkStaffOption = {
  id: string;
  name: string;
};

export type SaveInternalWorkInput = {
  idempotencyKey: string;
  organizationId: string;
  staffId?: string | null;
  title: string;
  workType: string;
  startAt: string;
  endAt: string;
  workHours: number;
  note?: string;
};

async function getInternalWorkPermission(
  organizationId: string,
  userId: string,
  action: InternalWorkAction,
): Promise<{ scope: 'all' | 'assigned' | 'none'; ownStaffId: string | null }> {
  const sessionClient = await createSessionClient();
  const { data: member, error } = await sessionClient
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw sanitizeDbError(error, 'action.internalWork.membership');
  if (!member) throw new ExpectedActionError('FORBIDDEN', 'この事業所へのアクセス権がありません');
  if (member.role === 'owner') {
    return { scope: 'all', ownStaffId: await getOptionalMyStaffId(organizationId, userId) };
  }

  const { data: roleLinks, error: roleError } = await sessionClient
    .from('organization_member_roles')
    .select('organization_roles(permissions)')
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (roleError) throw sanitizeDbError(roleError, 'action.internalWork');

  type RoleLinkRow = { organization_roles: { permissions?: unknown } | Array<{ permissions?: unknown }> | null };
  const scopes = ((roleLinks ?? []) as RoleLinkRow[])
    .map((row) => (Array.isArray(row.organization_roles) ? row.organization_roles[0]?.permissions : row.organization_roles?.permissions))
    .map((permissions) => normalizePermissions(permissions as Parameters<typeof normalizePermissions>[0]).internalWork[action]);

  const scope = scopes.includes('all') ? 'all' : scopes.includes('assigned') ? 'assigned' : 'none';
  return { scope, ownStaffId: await getOptionalMyStaffId(organizationId, userId) };
}

async function getOptionalMyStaffId(organizationId: string, userId: string): Promise<string | null> {
  const sessionClient = await createSessionClient();
  const { data, error } = await sessionClient
    .from('staffs')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw sanitizeDbError(error, 'action.internalWork');
  return data?.id ?? null;
}

async function assertStaffInOrg(organizationId: string, staffId: string): Promise<void> {
  const sessionClient = await createSessionClient();
  const { data, error } = await sessionClient
    .from('staffs')
    .select('id')
    .eq('id', staffId)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw sanitizeDbError(error, 'action.internalWork');
  if (!data) throw new ExpectedActionError('NOT_FOUND', '対象スタッフが見つかりません');
}

export async function saveInternalWork(input: SaveInternalWorkInput) {
  return withActionResult('saveInternalWork', async () => {
    const { userId } = await assertOrgRole(input.organizationId);
    const permission = await getInternalWorkPermission(input.organizationId, userId, 'create');
    if (permission.scope === 'none') throw new ExpectedActionError('FORBIDDEN', '内勤を記録する権限がありません');

    const requestedStaffId = input.staffId || permission.ownStaffId;
    if (!requestedStaffId) throw new ExpectedActionError('STAFF_NOT_LINKED', 'ログイン中のアカウントに紐づくスタッフが見つかりません');
    if (permission.scope !== 'all' && requestedStaffId !== permission.ownStaffId) {
      throw new ExpectedActionError('FORBIDDEN', '他のスタッフの内勤を記録する権限がありません');
    }
    await assertStaffInOrg(input.organizationId, requestedStaffId);

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
      throw new ExpectedActionError('VALIDATION_ERROR', '冪等性キーが不正です');
    }

    const title = input.title.trim();
    const workType = input.workType.trim() || 'meeting';
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    const workHours = Number(input.workHours);

    if (!title || title.length > 100) throw new ExpectedActionError('VALIDATION_ERROR', '件名を1〜100文字で入力してください');
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
      throw new ExpectedActionError('VALIDATION_ERROR', '開始・終了日時が不正です');
    }
    if (!Number.isFinite(workHours) || workHours <= 0 || workHours > 24) {
      throw new ExpectedActionError('VALIDATION_ERROR', '内勤時間を0より大きく24以下で入力してください');
    }

    const sessionClient = await createSessionClient();
    const { data, error } = await sessionClient.rpc('save_internal_work_idempotent', {
      p_organization_id: input.organizationId,
      p_staff_id: requestedStaffId,
      p_idempotency_key: input.idempotencyKey,
      p_title: title,
      p_work_type: workType,
      p_start_at: startAt.toISOString(),
      p_end_at: endAt.toISOString(),
      p_work_hours: workHours,
      p_note: input.note?.trim() || '',
    });
    if (error?.code === 'CR409') {
      throw new ExpectedActionError('VALIDATION_ERROR', '同じ保存キーで入力内容が変更されています。入力を変更して保存し直してください。');
    }
    if (error) throw sanitizeDbError({ code: error.code }, 'action.internalWork');
    const result = data && asJsonRecord(data);
    if (!result || typeof result.id !== 'string') {
      throw sanitizeDbError({ code: 'invalid_save_result' }, 'action.internalWork');
    }
    return { success: true, id: result.id };
  });
}

export async function listInternalWorkRecords(
  organizationId: string,
  startAt: string,
  endAt: string,
  staffId?: string | null,
): Promise<ActionResult<InternalWorkRecord[]>> {
  return withActionResult('listInternalWorkRecords', async () => {
    const user = await getAuthedUser();
    await assertOrgRole(organizationId);
    const permission = await getInternalWorkPermission(organizationId, user.id, 'view');
    if (permission.scope === 'none') throw new ExpectedActionError('FORBIDDEN', '内勤実績を閲覧する権限がありません');

    const targetStaffId = permission.scope === 'all' ? (staffId || null) : permission.ownStaffId;
    if (permission.scope !== 'all' && !targetStaffId) return [];
    if (targetStaffId) await assertStaffInOrg(organizationId, targetStaffId);

    const sessionClient = await createSessionClient();
    let query = sessionClient
      .from('internal_work_records')
      .select('id, organization_id, staff_id, title, work_type, start_at, end_at, work_hours, status, note, staffs(name)')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .gte('end_at', startAt)
      .lte('start_at', endAt);

    if (targetStaffId) query = query.eq('staff_id', targetStaffId);

    const { data, error } = await query.order('start_at', { ascending: false }).order('id');

    if (error) throw sanitizeDbError(error, 'action.internalWork');
    return (data ?? []) as unknown as InternalWorkRecord[];
  });
}

export async function getInternalWorkPageData(
  organizationId: string,
  startAt: string,
  endAt: string,
  staffId?: string | null,
): Promise<ActionResult<{ records: InternalWorkRecord[]; staffOptions: InternalWorkStaffOption[] }>> {
  return withActionResult('getInternalWorkPageData', async () => {
    const user = await getAuthedUser();
    await assertOrgRole(organizationId);

    const [records, staffOptions] = await Promise.all([
      (async (): Promise<InternalWorkRecord[]> => {
        const permission = await getInternalWorkPermission(organizationId, user.id, 'view');
        if (permission.scope === 'none') throw new ExpectedActionError('FORBIDDEN', '内勤実績を閲覧する権限がありません');

        const targetStaffId = permission.scope === 'all' ? (staffId || null) : permission.ownStaffId;
        if (permission.scope !== 'all' && !targetStaffId) return [];
        if (targetStaffId) await assertStaffInOrg(organizationId, targetStaffId);

        const sessionClient = await createSessionClient();
        let query = sessionClient
          .from('internal_work_records')
          .select('id, organization_id, staff_id, title, work_type, start_at, end_at, work_hours, status, note, staffs(name)')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .gte('end_at', startAt)
          .lte('start_at', endAt);

        if (targetStaffId) query = query.eq('staff_id', targetStaffId);

        const { data, error } = await query.order('start_at', { ascending: false }).order('id');

        if (error) throw sanitizeDbError(error, 'action.internalWork');
        return (data ?? []) as unknown as InternalWorkRecord[];
      })(),
      (async (): Promise<InternalWorkStaffOption[]> => {
        const permission = await getInternalWorkPermission(organizationId, user.id, 'create');
        if (permission.scope === 'none') return [];

        const sessionClient = await createSessionClient();
        let query = sessionClient
          .from('staffs')
          .select('id, name')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .is('archived_at', null);
        if (permission.scope !== 'all') {
          if (!permission.ownStaffId) return [];
          query = query.eq('id', permission.ownStaffId);
        }

        const { data, error } = await query
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true });
        if (error) throw sanitizeDbError(error, 'action.internalWork');
        return (data ?? []) as InternalWorkStaffOption[];
      })(),
    ]);

    return { records, staffOptions };
  });
}

export async function listMyInternalWorkRecords(
  organizationId: string,
  startAt: string,
  endAt: string,
): Promise<ActionResult<InternalWorkRecord[]>> {
  return withActionResult('listMyInternalWorkRecords', async () => {
    return requireActionResult(listInternalWorkRecords(organizationId, startAt, endAt));
  });
}

export async function listInternalWorkStaffOptions(organizationId: string): Promise<ActionResult<InternalWorkStaffOption[]>> {
  return withActionResult('listInternalWorkStaffOptions', async () => {
    const user = await getAuthedUser();
    await assertOrgRole(organizationId);
    const permission = await getInternalWorkPermission(organizationId, user.id, 'create');
    if (permission.scope === 'none') return [];

    const sessionClient = await createSessionClient();
    let query = sessionClient
      .from('staffs')
      .select('id, name')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .is('archived_at', null);
    if (permission.scope !== 'all') {
      if (!permission.ownStaffId) return [];
      query = query.eq('id', permission.ownStaffId);
    }

    const { data, error } = await query
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });
    if (error) throw sanitizeDbError(error, 'action.internalWork');
    return (data ?? []) as InternalWorkStaffOption[];
  });
}

export async function listInternalWorkRecordsForStatistics(
  organizationId: string,
  startAt: string,
  endAt: string,
): Promise<ActionResult<InternalWorkRecord[]>> {
  return withActionResult('listInternalWorkRecordsForStatistics', async () => {
    await assertOrgPermission(organizationId, 'reports');

    const sessionClient = await createSessionClient();
    const { data, error } = await sessionClient
      .from('internal_work_records')
      .select('id, organization_id, staff_id, title, work_type, start_at, end_at, work_hours, status, note, staffs(name)')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .gte('end_at', startAt)
      .lte('start_at', endAt)
      .order('start_at', { ascending: true });

    if (error) throw sanitizeDbError(error, 'action.internalWork');
    return (data ?? []) as unknown as InternalWorkRecord[];
  });
}

/** Own history stays own even when the user can view all internal work. */
export async function getMyInternalWorkHistory(organizationId: string, options: { startAt?: string; endAt?: string } = {}): Promise<ActionResult<InternalWorkRecord[]>> {
  return withActionResult('getMyInternalWorkHistory', async () => {
    const user = await getAuthedUser();
    await assertOrgRole(organizationId);
    const permission = await getInternalWorkPermission(organizationId, user.id, 'view');
    if (permission.scope === 'none' || !permission.ownStaffId) return [];
    const session = await createSessionClient();
    let query = session.from('internal_work_records')
      .select('id, organization_id, staff_id, recorded_by, title, work_type, start_at, end_at, work_hours, status, note, staffs(name)')
      .eq('organization_id', organizationId).eq('staff_id', permission.ownStaffId)
      .is('deleted_at', null).order('start_at', { ascending: false }).order('id').limit(100);
    if (options.startAt) query = query.gte('start_at', options.startAt);
    if (options.endAt) query = query.lt('start_at', options.endAt);
    const { data, error } = await query;
    if (error) throw sanitizeDbError(error, 'action.internalWork');
    return (data ?? []) as unknown as InternalWorkRecord[];
  });
}
