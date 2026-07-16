'use server';

// 削除承認ワークフロー（3省2ガイドライン: 内部統制 / 申請と承認の分離）。
// 直接削除（softDeleteReports）に加え、申請→owner承認→論理削除の経路を提供する。
// deletion_requests は caller JWT とDB側の事業所・権限検証を必須とする。

import { assertOrgPermission, assertOrgRole, assertRecordPermission, createSessionClient } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { sanitizeDbError } from '@/utils/errors';

function normalizeReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 2 || r.length > 500) throw new Error('理由を2〜500文字で入力してください');
  return r;
}

async function assertReportInOrg(reportId: string, organizationId: string): Promise<void> {
  const sessionClient = await createSessionClient();
  const { data, error } = await sessionClient
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

  const sessionClient = await createSessionClient();
  const { data: requestId, error } = await sessionClient.rpc('request_report_deletion', {
    p_org_id: organizationId, p_report_id: reportId, p_reason: normalized,
  });
  if (error || !requestId) throw sanitizeDbError(error, 'deletionRequests.request');

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'deletion_request.create',
    resourceType: 'deletion_request',
    resourceId: String(requestId),
    details: { resourceType: 'report', resourceId: reportId, reason: normalized },
  });
  return { success: true, requestId: String(requestId) };
}

/** 承認待ち（およびそれ以外）の削除申請を一覧する（owner/manager）。 */
export async function listDeletionRequests(organizationId: string, status: 'requested' | 'approved' | 'rejected' | 'completed' | 'all' = 'requested') {
  await assertOrgPermission(organizationId, 'reports');
  const sessionClient = await createSessionClient();
  let query = sessionClient
    .from('deletion_requests')
    .select('*, requester:requested_by(name)')
    .eq('organization_id', organizationId);
  if (status !== 'all') query = query.eq('status', status);
  const { data, error } = await query.order('requested_at', { ascending: false }).limit(200);
  if (error) throw sanitizeDbError(error, 'deletionRequests.list');
  return data;
}

/** 削除申請を承認し、実際の論理削除を実行する（レポート管理権限）。 */
export async function approveDeletionRequest(organizationId: string, requestId: string) {
  const { userId } = await assertOrgPermission(organizationId, 'reports');

  const sessionClient = await createSessionClient();
  const { data: req, error: reqError } = await sessionClient
    .from('deletion_requests')
    .select('id, resource_type, resource_id, status, reason')
    .eq('id', requestId)
    .eq('organization_id', organizationId)
    .single();
  if (reqError || !req) throw new Error('削除申請が見つかりません');
  if (req.status !== 'requested') throw new Error('この申請は既に処理済みです');
  if (req.resource_type !== 'report') throw new Error('未対応の対象種別です');

  await assertReportInOrg(req.resource_id, organizationId);
  await assertRecordPermission(organizationId, 'delete', { reportId: req.resource_id });

  const { data: result, error: decisionError } = await sessionClient.rpc('decide_report_deletion', {
    p_org_id: organizationId, p_request_id: requestId, p_decision: 'approve',
  });
  if (decisionError) throw sanitizeDbError(decisionError, 'deletionRequests.approve');
  const retentionUntil = (result as { retentionUntil?: string } | null)?.retentionUntil;

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'deletion_request.approve',
    resourceType: 'report',
    resourceId: req.resource_id,
    details: { requestId, retentionUntil },
  });
  return { success: true };
}

/** 削除申請を却下する（レポート管理権限）。 */
export async function rejectDeletionRequest(organizationId: string, requestId: string, reason: string) {
  const { userId } = await assertOrgPermission(organizationId, 'reports');
  const normalized = normalizeReason(reason);

  const sessionClient = await createSessionClient();
  const { data: req, error: reqError } = await sessionClient
    .from('deletion_requests')
    .select('id, status, resource_id')
    .eq('id', requestId)
    .eq('organization_id', organizationId)
    .single();
  if (reqError || !req) throw new Error('削除申請が見つかりません');
  if (req.status !== 'requested') throw new Error('この申請は既に処理済みです');

  const { error } = await sessionClient.rpc('decide_report_deletion', {
    p_org_id: organizationId, p_request_id: requestId, p_decision: 'reject',
  });
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
