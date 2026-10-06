'use server';
import type { ActionResult } from '@/types/actionResult';

import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
import { sanitizeRpcError } from '@/utils/supabase/rpcErrors';
import { createSessionClient, assertRecordPermission, assertShiftPermission } from '@/utils/supabase/auth';

function linkRpcError(error: { code?: string; message?: string }) {
  return sanitizeRpcError(error, 'action.reportShifts.link', [
    { databaseCode: 'P0001', databaseMessage: 'authentication required', code: 'SESSION_EXPIRED', message: 'セッションの有効期限が切れました。再度ログインしてください' },
    { databaseCode: 'P0001', databaseMessage: 'record edit permission required', code: 'FORBIDDEN', message: '記録を編集する権限がありません' },
    { databaseCode: 'P0001', databaseMessage: 'shift view permission required', code: 'FORBIDDEN', message: 'シフトを閲覧する権限がありません' },
    { databaseCode: 'P0001', databaseMessage: 'resource access denied', code: 'FORBIDDEN', message: '対象の記録またはシフトにアクセスできません' },
    { databaseCode: 'P0001', databaseMessage: 'record not found', code: 'NOT_FOUND', message: '対象の記録が見つかりません' },
    { databaseCode: 'P0001', databaseMessage: 'shift not found', code: 'NOT_FOUND', message: '対象のシフトが見つかりません' },
    { databaseCode: 'P0001', databaseMessage: 'approved records cannot be linked', code: 'FORBIDDEN', message: '承認済みの記録へシフトを紐付けできません' },
    { databaseCode: 'P0001', databaseMessage: 'primary shift cannot be removed', code: 'FORBIDDEN', message: '主シフトの紐付けは解除できません' },
  ]);
}

/** Returns candidate shifts to suggest linking: same client, overlapping time, not already linked. */
export async function getShiftSuggestions(
  orgId: string,
  reportId: string
): Promise<ActionResult<Array<{ id: string; title: string | null; start_at: string; end_at: string; staffName: string | null }>>> {
  return withActionResult('getShiftSuggestions', async () => {
    await assertRecordPermission(orgId, 'view', { reportId });
    const supabase = await createSessionClient();

    // Get primary shift of the report
    const { data: primaryLink, error: primaryError } = await supabase
      .from('report_shifts')
      .select('shift_id, shifts(start_at, end_at, client_id)')
      .eq('report_id', reportId)
      .eq('is_primary', true)
      .maybeSingle();

    if (primaryError) throw sanitizeDbError(primaryError, 'action.reportShifts.primary');
    if (!primaryLink?.shift_id) return [];
    const primary = primaryLink.shifts as unknown as { start_at: string; end_at: string; client_id: string } | null;
    if (!primary) return [];
    await assertShiftPermission(orgId, 'view', { clientId: primary.client_id });

    // Get already-linked shift IDs
    const { data: existing, error: existingError } = await supabase.from('report_shifts').select('shift_id').eq('report_id', reportId);
    if (existingError) throw sanitizeDbError(existingError, 'action.reportShifts.existing');
    const linkedIds = new Set((existing ?? []).map((r: { shift_id: string }) => r.shift_id));

    // Find overlapping candidate shifts
    const { data: candidates, error: candidatesError } = await supabase
      .from('shifts')
      .select('id, title, start_at, end_at, shift_staffs(staffs(name))')
      .eq('client_id', primary.client_id)
      .neq('status', 'cancelled')
      .lt('start_at', primary.end_at)
      .gt('end_at', primary.start_at)
      .neq('id', primaryLink.shift_id)
      .is('deleted_at', null);

    if (candidatesError) throw sanitizeDbError(candidatesError, 'action.reportShifts.candidates');
    return (candidates ?? [])
      .filter((c: { id: string }) => !linkedIds.has(c.id))
      .map((c: { id: string; title: string | null; start_at: string; end_at: string; shift_staffs: Array<{ staffs: { name: string } | null }> }) => ({
        id: c.id,
        title: c.title,
        start_at: c.start_at,
        end_at: c.end_at,
        staffName: c.shift_staffs?.[0]?.staffs?.name ?? null,
      }));
  });
}

/** Links a secondary shift to a report (draft/remanded only). */
export async function addShiftLink(orgId: string, reportId: string, shiftId: string): Promise<ActionResult<void>> {
  return withActionResult('addShiftLink', async () => {
    await assertRecordPermission(orgId, 'edit', { reportId });
    await assertShiftPermission(orgId, 'view', { shiftId });
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('add_report_shift_link', { p_org_id: orgId, p_report_id: reportId, p_shift_id: shiftId });
    if (error) throw linkRpcError(error);
  });
}

/** Removes a non-primary shift link. */
export async function removeShiftLink(orgId: string, reportId: string, shiftId: string): Promise<ActionResult<void>> {
  return withActionResult('removeShiftLink', async () => {
    await assertRecordPermission(orgId, 'edit', { reportId });
    await assertShiftPermission(orgId, 'view', { shiftId });
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('remove_report_shift_link', { p_org_id: orgId, p_report_id: reportId, p_shift_id: shiftId });
    if (error) throw linkRpcError(error);
  });
}

/** Returns all shifts linked to a report. */
export async function getLinkedShifts(reportId: string): Promise<ActionResult<unknown[]>> {
  return withActionResult('getLinkedShifts', async () => {
    const supabase = await createSessionClient();
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('id, clients!inner(organization_id)')
      .eq('id', reportId)
      .maybeSingle();
    if (reportError) throw sanitizeDbError(reportError, 'action.reportShifts.report');
    const orgId = (report as { clients?: { organization_id?: string } | Array<{ organization_id?: string }> } | null)?.clients;
    const organizationId = Array.isArray(orgId) ? orgId[0]?.organization_id : orgId?.organization_id;
    if (!organizationId) throw new ExpectedActionError('NOT_FOUND', '記録にアクセスできません');
    await assertRecordPermission(organizationId, 'view', { reportId });
    const { data, error } = await supabase
      .from('report_shifts')
      .select('shift_id, is_primary, shifts(id, title, start_at, end_at, shift_staffs(staffs(name)))')
      .eq('report_id', reportId);
    if (error) throw sanitizeDbError(error, 'action.reportShifts');
    return (data ?? []) as unknown[];
  });
}
