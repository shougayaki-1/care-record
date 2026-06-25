'use server';

// 削除承認ワークフロー（3省2ガイドライン: 内部統制 / 申請と承認の分離）。
// 直接削除（softDeleteReports）に加え、申請→owner承認→論理削除の経路を提供する。
// deletion_requests は service_role のみアクセス可（RLSで REVOKE 済み）。

import { assertOrgRole, supabaseAdmin } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { sanitizeDbError } from '@/utils/errors';

function normalizeReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 2 || r.length > 500) throw new Error('理由を2〜500文字で入力してください');
  return r;
}

async function assertReportInOrg(reportId: string, organizationId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('reports')
    .select('id, clients!inner(organization_id)')
    .eq('id', reportId)
    .single();
  if (error || !data) throw new Error('対象の記録が見つかりません');
  const orgId = (data as { clients?: { organization_id?: string } }).clients?.organization_id;
  if (orgId !== organizationId) throw new Error('対象の記録にアクセスできません');
}

/** レポートの削除を申請する（staff/manager/owner いずれも申請可）。 */
export async function requestReportDeletion(organizationId: string, reportId: string, reason: string) {
  const { userId } = await assertOrgRole(organizationId);
  const normalized = normalizeReason(reason);
  await assertReportInOrg(reportId, organizationId);

  const { data, error } = await supabaseAdmin
    .from('deletion_requests')
    .insert({
      organization_id: organizationId,
      resource_type: 'report',
      resource_id: reportId,
      requested_by: userId,
      reason: normalized,
      status: 'requested',
    })
    .select('id')
    .single();
  if (error || !data) throw sanitizeDbError(error, 'deletionRequests.request');

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'deletion_request.create',
    resourceType: 'deletion_request',
    resourceId: data.id,
    details: { resourceType: 'report', resourceId: reportId, reason: normalized },
  });
  return { success: true, requestId: data.id };
}

/** 承認待ち（およびそれ以外）の削除申請を一覧する（owner/manager）。 */
export async function listDeletionRequests(organizationId: string, status: 'requested' | 'approved' | 'rejected' | 'completed' | 'all' = 'requested') {
  await assertOrgRole(organizationId, ['owner', 'member']);
  let query = supabaseAdmin
    .from('deletion_requests')
    .select('*, requester:requested_by(name)')
    .eq('organization_id', organizationId);
  if (status !== 'all') query = query.eq('status', status);
  const { data, error } = await query.order('requested_at', { ascending: false }).limit(200);
  if (error) throw sanitizeDbError(error, 'deletionRequests.list');
  return data;
}

/** 削除申請を承認し、実際の論理削除を実行する（owner のみ）。 */
export async function approveDeletionRequest(organizationId: string, requestId: string) {
  const { userId } = await assertOrgRole(organizationId, ['owner']);

  const { data: req, error: reqError } = await supabaseAdmin
    .from('deletion_requests')
    .select('id, resource_type, resource_id, status, reason')
    .eq('id', requestId)
    .eq('organization_id', organizationId)
    .single();
  if (reqError || !req) throw new Error('削除申請が見つかりません');
  if (req.status !== 'requested') throw new Error('この申請は既に処理済みです');
  if (req.resource_type !== 'report') throw new Error('未対応の対象種別です');

  await assertReportInOrg(req.resource_id, organizationId);

  // 保持期間を解決して論理削除する。
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations').select('retention_years').eq('id', organizationId).single();
  if (orgError || !org) throw sanitizeDbError(orgError, 'deletionRequests.approve');

  const deletedAt = new Date();
  const retentionUntil = new Date(deletedAt);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (org.retention_years || 5));

  const { error: delError } = await supabaseAdmin
    .from('reports')
    .update({
      deleted_at: deletedAt.toISOString(),
      deleted_by: userId,
      deletion_reason: req.reason,
      retention_until: retentionUntil.toISOString(),
      updated_at: deletedAt.toISOString(),
    })
    .eq('id', req.resource_id)
    .is('deleted_at', null);
  if (delError) throw sanitizeDbError(delError, 'deletionRequests.approve');

  const { error: updError } = await supabaseAdmin
    .from('deletion_requests')
    .update({ status: 'completed', approved_by: userId, decided_at: deletedAt.toISOString(), completed_at: deletedAt.toISOString() })
    .eq('id', requestId);
  if (updError) throw sanitizeDbError(updError, 'deletionRequests.approve');

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'deletion_request.approve',
    resourceType: 'report',
    resourceId: req.resource_id,
    details: { requestId, retentionUntil: retentionUntil.toISOString() },
  });
  return { success: true };
}

/** 削除申請を却下する（owner のみ）。 */
export async function rejectDeletionRequest(organizationId: string, requestId: string, reason: string) {
  const { userId } = await assertOrgRole(organizationId, ['owner']);
  const normalized = normalizeReason(reason);

  const { data: req, error: reqError } = await supabaseAdmin
    .from('deletion_requests')
    .select('id, status, resource_id')
    .eq('id', requestId)
    .eq('organization_id', organizationId)
    .single();
  if (reqError || !req) throw new Error('削除申請が見つかりません');
  if (req.status !== 'requested') throw new Error('この申請は既に処理済みです');

  const { error } = await supabaseAdmin
    .from('deletion_requests')
    .update({ status: 'rejected', approved_by: userId, decided_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw sanitizeDbError(error, 'deletionRequests.reject');

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'deletion_request.reject',
    resourceType: 'deletion_request',
    resourceId: requestId,
    details: { reason: normalized },
  });
  return { success: true };
}
