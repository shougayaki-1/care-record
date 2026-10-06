'use server';

import { withActionResult } from '@/utils/errors';

// 削除承認ワークフロー（3省2ガイドライン: 内部統制 / 申請と承認の分離）。
// 直接削除（softDeleteReports）に加え、申請→owner承認→論理削除の経路を提供する。
// deletion_requests は caller JWT とDB側の事業所・権限検証を必須とする。

import { assertOrgPermission, assertOrgRole, assertRecordPermission, createSessionClient } from '@/utils/supabase/auth';
import { sanitizeRpcError } from '@/utils/supabase/rpcErrors';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { ExpectedActionError, sanitizeDbError } from '@/utils/errors';

function deletionRpcError(error: { code?: string; message?: string }, context: string) {
  return sanitizeRpcError(error, context, [
    { databaseCode: 'P0001', databaseMessage: 'authentication_required', code: 'SESSION_EXPIRED', message: 'セッションの有効期限が切れました。再度ログインしてください' },
    { databaseCode: 'P0001', databaseMessage: 'permission_denied', code: 'FORBIDDEN', message: 'この操作を行う権限がありません' },
    { databaseCode: 'P0001', databaseMessage: 'record_permission_denied', code: 'FORBIDDEN', message: '対象の記録にアクセスできません' },
    { databaseCode: 'P0001', databaseMessage: 'report_not_found', code: 'NOT_FOUND', message: '対象の記録が見つかりません' },
    { databaseCode: 'P0001', databaseMessage: 'request_not_found', code: 'NOT_FOUND', message: '削除申請が見つかりません' },
    { databaseCode: 'P0001', databaseMessage: 'already_decided', code: 'VALIDATION_ERROR', message: 'この申請は既に処理済みです' },
    { databaseCode: 'P0001', databaseMessage: 'unsupported_resource', code: 'VALIDATION_ERROR', message: '未対応の対象種別です' },
  ]);
}

function normalizeReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 2 || r.length > 500) throw new ExpectedActionError('VALIDATION_ERROR', '理由を2〜500文字で入力してください');
  return r;
}

async function assertReportInOrg(reportId: string, organizationId: string): Promise<void> {
  const sessionClient = await createSessionClient();
  const { data, error } = await sessionClient
    .from('reports')
    .select('id, clients!inner(organization_id)')
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw sanitizeDbError(error, 'deletionRequests.report');
  if (!data) throw new ExpectedActionError('NOT_FOUND', '対象の記録が見つかりません');
  const orgId = (data as { clients?: { organization_id?: string } }).clients?.organization_id;
  if (orgId !== organizationId) throw new ExpectedActionError('FORBIDDEN', '対象の記録にアクセスできません');
}

/** レポートの削除を申請する（staff/manager/owner いずれも申請可）。 */
export async function requestReportDeletion(organizationId: string, reportId: string, reason: string) {
  return withActionResult('requestReportDeletion', async () => {
    const { userId } = await assertOrgRole(organizationId);
    const normalized = normalizeReason(reason);
    await assertReportInOrg(reportId, organizationId);

    const sessionClient = await createSessionClient();
    const { data: requestId, error } = await sessionClient.rpc('request_report_deletion', {
      p_org_id: organizationId, p_report_id: reportId, p_reason: normalized,
    });
    if (error) throw deletionRpcError(error, 'deletionRequests.request');
    if (!requestId) throw new Error('Deletion request returned no ID');

    await recordAuditEvent({
      organizationId,
      actorId: userId,
      action: 'deletion_request.create',
      resourceType: 'deletion_request',
      resourceId: String(requestId),
      details: { resourceType: 'report', resourceId: reportId, reason: normalized },
    });
    return { success: true, requestId: String(requestId) };
  });
}

/** 承認待ち（およびそれ以外）の削除申請を一覧する（管理権限または本人の申請）。 */
export async function listDeletionRequests(organizationId: string, status: 'requested' | 'approved' | 'rejected' | 'completed' | 'all' = 'requested', requestId?: string) {
  return withActionResult('listDeletionRequests', async () => {
    await assertOrgRole(organizationId);
    const sessionClient = await createSessionClient();
    let query = sessionClient
      .from('deletion_requests')
      .select('*, requester:requested_by(name)')
      .eq('organization_id', organizationId);
    if (status !== 'all') query = query.eq('status', status);
    if (requestId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new ExpectedActionError('VALIDATION_ERROR', '申請IDが不正です');
      query = query.eq('id', requestId);
    }
    const { data, error } = await query.order('requested_at', { ascending: false }).limit(200);
    if (error) throw sanitizeDbError(error, 'deletionRequests.list');
    const rows = data ?? [];
    const reportIds = rows.filter(row => row.resource_type === 'report').map(row => row.resource_id);
    const clientIds = new Map<string, string>();
    if (reportIds.length > 0) {
      // Ordinary report SELECT RLS still controls the detail link. A request or
      // notification never provides access to a report that cannot be viewed.
      const { data: reports, error: reportError } = await sessionClient.from('reports')
        .select('id, client_id').in('id', reportIds);
      if (reportError) throw sanitizeDbError(reportError, 'deletionRequests.report-links');
      for (const report of reports ?? []) clientIds.set(report.id, report.client_id);
    }
    return rows.map(row => ({ ...row, clientId: clientIds.get(row.resource_id) ?? null }));
  });
}

/** 削除申請を承認し、実際の論理削除を実行する（レポート管理権限）。 */
export async function approveDeletionRequest(organizationId: string, requestId: string) {
  return withActionResult('approveDeletionRequest', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'reports');

    const sessionClient = await createSessionClient();
    const { data: req, error: reqError } = await sessionClient
      .from('deletion_requests')
      .select('id, resource_type, resource_id, status, reason')
      .eq('id', requestId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (reqError) throw sanitizeDbError(reqError, 'deletionRequests.request-read');
    if (!req) throw new ExpectedActionError('NOT_FOUND', '削除申請が見つかりません');
    if (req.status !== 'requested') throw new ExpectedActionError('VALIDATION_ERROR', 'この申請は既に処理済みです');
    if (req.resource_type !== 'report') throw new ExpectedActionError('VALIDATION_ERROR', '未対応の対象種別です');

    await assertReportInOrg(req.resource_id, organizationId);
    await assertRecordPermission(organizationId, 'delete', { reportId: req.resource_id });

    const { data: result, error: decisionError } = await sessionClient.rpc('decide_report_deletion', {
      p_org_id: organizationId, p_request_id: requestId, p_decision: 'approve',
    });
    if (decisionError) throw deletionRpcError(decisionError, 'deletionRequests.approve');
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
  });
}

/** 削除申請を却下する（レポート管理権限）。 */
export async function rejectDeletionRequest(organizationId: string, requestId: string, reason: string) {
  return withActionResult('rejectDeletionRequest', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'reports');
    const normalized = normalizeReason(reason);

    const sessionClient = await createSessionClient();
    const { data: req, error: reqError } = await sessionClient
      .from('deletion_requests')
      .select('id, status, resource_id')
      .eq('id', requestId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (reqError) throw sanitizeDbError(reqError, 'deletionRequests.request-read');
    if (!req) throw new ExpectedActionError('NOT_FOUND', '削除申請が見つかりません');
    if (req.status !== 'requested') throw new ExpectedActionError('VALIDATION_ERROR', 'この申請は既に処理済みです');

    const { error } = await sessionClient.rpc('decide_report_deletion', {
      p_org_id: organizationId, p_request_id: requestId, p_decision: 'reject',
    });
    if (error) throw deletionRpcError(error, 'deletionRequests.reject');

    await recordAuditEvent({
      organizationId,
      actorId: userId,
      action: 'deletion_request.reject',
      resourceType: 'deletion_request',
      resourceId: requestId,
      details: { reason: normalized },
    });
    return { success: true };
  });
}
