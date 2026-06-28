'use server';
import { supabaseAdmin, assertRecordPermission, assertShiftPermission } from '@/utils/supabase/auth';

/** Returns candidate shifts to suggest linking: same client, overlapping time, not already linked. */
export async function getShiftSuggestions(
  orgId: string,
  reportId: string
): Promise<Array<{ id: string; title: string | null; start_at: string; end_at: string; staffName: string | null }>> {
  await assertRecordPermission(orgId, 'view', { reportId });

  // Get primary shift of the report
  const { data: primaryLink } = await supabaseAdmin
    .from('report_shifts')
    .select('shift_id, shifts(start_at, end_at, client_id)')
    .eq('report_id', reportId)
    .eq('is_primary', true)
    .maybeSingle();

  if (!primaryLink?.shift_id) return [];
  const primary = primaryLink.shifts as unknown as { start_at: string; end_at: string; client_id: string } | null;
  if (!primary) return [];
  await assertShiftPermission(orgId, 'view', { clientId: primary.client_id });

  // Get already-linked shift IDs
  const { data: existing } = await supabaseAdmin.from('report_shifts').select('shift_id').eq('report_id', reportId);
  const linkedIds = new Set((existing ?? []).map((r: { shift_id: string }) => r.shift_id));

  // Find overlapping candidate shifts
  const { data: candidates } = await supabaseAdmin
    .from('shifts')
    .select('id, title, start_at, end_at, shift_staffs(staffs(name))')
    .eq('client_id', primary.client_id)
    .neq('status', 'cancelled')
    .lt('start_at', primary.end_at)
    .gt('end_at', primary.start_at)
    .neq('id', primaryLink.shift_id)
    .is('deleted_at', null);

  return (candidates ?? [])
    .filter((c: { id: string }) => !linkedIds.has(c.id))
    .map((c: { id: string; title: string | null; start_at: string; end_at: string; shift_staffs: Array<{ staffs: Array<{ name: string }> }> }) => ({
      id: c.id,
      title: c.title,
      start_at: c.start_at,
      end_at: c.end_at,
      staffName: c.shift_staffs?.[0]?.staffs?.[0]?.name ?? null,
    }));
}

/** Links a secondary shift to a report (draft/remanded only). */
export async function addShiftLink(orgId: string, reportId: string, shiftId: string): Promise<void> {
  await assertRecordPermission(orgId, 'edit', { reportId });
  await assertShiftPermission(orgId, 'view', { shiftId });

  const { data: report } = await supabaseAdmin.from('reports').select('status').eq('id', reportId).single();
  if (!report) throw new Error('記録が見つかりません');
  if (!['draft', 'remanded'].includes(report.status)) throw new Error('承認済みの記録にはシフトを追加できません');

  const { error } = await supabaseAdmin.from('report_shifts').insert({ report_id: reportId, shift_id: shiftId, is_primary: false });
  if (error) throw new Error('シフトの紐付けに失敗しました');
}

/** Removes a non-primary shift link. */
export async function removeShiftLink(orgId: string, reportId: string, shiftId: string): Promise<void> {
  await assertRecordPermission(orgId, 'edit', { reportId });
  await assertShiftPermission(orgId, 'view', { shiftId });

  const { data: link } = await supabaseAdmin.from('report_shifts').select('is_primary').eq('report_id', reportId).eq('shift_id', shiftId).maybeSingle();
  if (link?.is_primary) throw new Error('主シフトは解除できません');

  const { error } = await supabaseAdmin.from('report_shifts').delete().eq('report_id', reportId).eq('shift_id', shiftId);
  if (error) throw new Error('シフトの解除に失敗しました');
}

/** Returns all shifts linked to a report. */
export async function getLinkedShifts(reportId: string): Promise<unknown[]> {
  const { data: report } = await supabaseAdmin
    .from('reports')
    .select('id, clients!inner(organization_id)')
    .eq('id', reportId)
    .maybeSingle();
  const orgId = (report as { clients?: { organization_id?: string } | Array<{ organization_id?: string }> } | null)?.clients;
  const organizationId = Array.isArray(orgId) ? orgId[0]?.organization_id : orgId?.organization_id;
  if (!organizationId) throw new Error('記録にアクセスできません');
  await assertRecordPermission(organizationId, 'view', { reportId });
  const { data, error } = await supabaseAdmin
    .from('report_shifts')
    .select('shift_id, is_primary, shifts(id, title, start_at, end_at, shift_staffs(staffs(name)))')
    .eq('report_id', reportId);
  if (error) throw new Error('シフト情報を取得できませんでした');
  return (data ?? []) as unknown[];
}
