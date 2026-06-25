'use server';

import { sanitizeDbError } from '@/utils/errors';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgRole, assertOrgPermission, createSessionClient, getAuthedUser, supabaseAdmin } from '@/utils/supabase/auth';
import { randomUUID } from 'crypto';
import { sanitizeUploadedImage } from '@/utils/uploadSecurity';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';

type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';

export type SaveReportInput = {
  organizationId: string;
  reportId?: string | null;
  clientId: string;
  shiftId?: string | null;
  startAt: string;
  endAt: string;
  status: ReportStatus;
  values: Record<string, unknown>;
};

async function assertStaffAssignment(userId: string, clientId: string) {
  const { data, error } = await supabaseAdmin
    .from('assignments')
    .select('client_id')
    .eq('helper_id', userId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error || !data) throw new Error('この利用者の記録を作成する権限がありません');
}

export async function saveReport(input: SaveReportInput) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
    throw new Error('開始・終了日時が不正です');
  }
  if (JSON.stringify(input.values).length > 1_000_000) {
    throw new Error('記録内容が大きすぎます');
  }
  const user = await getAuthedUser();
  const supabase = await createSessionClient();
  const { data: reportId, error } = await supabase.rpc('save_report_atomic', {
    p_organization_id: input.organizationId,
    p_report_id: input.reportId || null,
    p_client_id: input.clientId,
    p_shift_id: input.shiftId || null,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
    p_status: input.status,
    p_values: input.values,
    p_session_id: user.sessionId,
  });
  if (error || !reportId) {
    await recordAuditEvent({ organizationId: input.organizationId, actorId: user.id, action: 'report.save',
      resourceType: 'report', resourceId: input.reportId || null, outcome: 'failure', sessionId: user.sessionId,
      details: { attemptedStatus: input.status, errorType: error?.code || 'unknown' },
    });
    throw sanitizeDbError(error || new Error('記録を保存できませんでした'), 'action.reports');
  }
  return { success: true, reportId: String(reportId) };
}

export async function transitionReports(
  organizationId: string,
  reportIds: string[],
  transition: 'approve' | 'remand',
) {
  const ids = Array.from(new Set(reportIds.filter(Boolean)));
  if (ids.length === 0 || ids.length > 100) throw new Error('対象件数が不正です');
  const { userId } = await assertOrgPermission(organizationId, 'reports');

  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients').select('id').eq('organization_id', organizationId);
  if (clientError) throw new Error(clientError.message);
  const { data: reports, error } = await supabaseAdmin
    .from('reports')
    .select('id, status')
    .in('id', ids)
    .in('client_id', (clients || []).map((client) => client.id))
    .is('deleted_at', null);
  if (error) throw sanitizeDbError(error, 'action.reports');
  if ((reports || []).length !== ids.length) throw new Error('アクセスできない記録が含まれています');
  if (transition === 'approve' && (reports || []).some((report) => report.status === 'draft')) {
    throw new Error('下書きは承認できません');
  }
  if (transition === 'remand' && (reports || []).some((report) => report.status !== 'approved')) {
    throw new Error('承認済み記録だけ差し戻せます');
  }

  const now = new Date().toISOString();
  const update = transition === 'approve'
    ? { status: 'approved', approved_by: userId, approved_at: now, updated_at: now }
    : { status: 'remanded', approved_by: null, approved_at: null, updated_at: now };
  const { error: updateError } = await supabaseAdmin.from('reports').update(update).in('id', ids);
  if (updateError) throw new Error(updateError.message);

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: `report.bulk_${transition}`,
    resourceType: 'report',
    details: { reportIds: ids, count: ids.length },
  });
  return { success: true, updated: ids.length };
}

type ReportForDeletion = {
  id: string;
  status: string;
  helper_id: string | null;
  client_id: string;
  deleted_at: string | null;
};

export async function softDeleteReports(
  organizationId: string,
  reportIds: string[],
  reason: string,
) {
  const uniqueIds = Array.from(new Set(reportIds.filter(Boolean)));
  if (uniqueIds.length === 0 || uniqueIds.length > 100) {
    throw new Error('削除対象の件数が不正です');
  }
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 2 || normalizedReason.length > 500) {
    throw new Error('削除理由を2〜500文字で入力してください');
  }

  const { userId, role } = await assertOrgRole(organizationId);
  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', organizationId);
  if (clientError) throw new Error(clientError.message);
  const clientIds = (clients || []).map((client) => client.id);

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select('id, status, helper_id, client_id, deleted_at')
    .in('id', uniqueIds)
    .in('client_id', clientIds);
  if (error) throw sanitizeDbError(error, 'action.reports');

  const reports = (data || []) as ReportForDeletion[];
  if (reports.length !== uniqueIds.length) {
    throw new Error('削除対象にアクセスできない記録が含まれています');
  }
  if (reports.some((report) => report.deleted_at)) {
    throw new Error('既に削除済みの記録が含まれています');
  }
  if (reports.some((report) => report.status === 'approved')) {
    throw new Error('承認済みの記録は削除できません');
  }
  if (role === 'member' && reports.some((report) =>
    report.helper_id !== userId || !['draft', 'remanded'].includes(report.status)
  )) {
    throw new Error('自分の下書きまたは差戻し記録だけ削除できます');
  }

  const deletedAt = new Date();
  const policy = await getRetentionPolicy(organizationId, 'report');
  const retentionUntil = retentionDeadline(policy.years, deletedAt);

  const { error: updateError } = await supabaseAdmin
    .from('reports')
    .update({
      deleted_at: deletedAt.toISOString(),
      deleted_by: userId,
      deletion_reason: normalizedReason,
      retention_until: retentionUntil,
      updated_at: deletedAt.toISOString(),
    })
    .in('id', uniqueIds)
    .is('deleted_at', null);
  if (updateError) throw new Error(updateError.message);

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: uniqueIds.length === 1 ? 'report.soft_delete' : 'report.bulk_soft_delete',
    resourceType: 'report',
    resourceId: uniqueIds.length === 1 ? uniqueIds[0] : null,
    reason: normalizedReason,
    details: { reportIds: uniqueIds, count: uniqueIds.length, legalBasis: policy.legalBasis },
  });

  return { success: true, deleted: uniqueIds.length, retentionUntil };
}

export async function restoreReports(organizationId: string, reportIds: string[]) {
  const uniqueIds = Array.from(new Set(reportIds.filter(Boolean)));
  if (uniqueIds.length === 0 || uniqueIds.length > 100) {
    throw new Error('復元対象の件数が不正です');
  }
  const { userId } = await assertOrgPermission(organizationId, 'reports');

  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', organizationId);
  if (clientError) throw new Error(clientError.message);

  const { data: targets, error: targetError } = await supabaseAdmin
    .from('reports')
    .select('id')
    .in('id', uniqueIds)
    .in('client_id', (clients || []).map((client) => client.id))
    .not('deleted_at', 'is', null);
  if (targetError) throw new Error(targetError.message);
  if ((targets || []).length !== uniqueIds.length) {
    throw new Error('復元対象にアクセスできない記録が含まれています');
  }

  const { error } = await supabaseAdmin
    .from('reports')
    .update({
      deleted_at: null,
      deleted_by: null,
      deletion_reason: null,
      retention_until: null,
      updated_at: new Date().toISOString(),
    })
    .in('id', uniqueIds);
  if (error) throw sanitizeDbError(error, 'action.reports');

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: uniqueIds.length === 1 ? 'report.restore' : 'report.bulk_restore',
    resourceType: 'report',
    resourceId: uniqueIds.length === 1 ? uniqueIds[0] : null,
    details: { reportIds: uniqueIds, count: uniqueIds.length },
  });
  return { success: true, restored: uniqueIds.length };
}

async function getAccessibleReport(organizationId: string, reportId: string) {
  const { userId, role } = await assertOrgRole(organizationId);
  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients').select('id').eq('organization_id', organizationId);
  if (clientError) throw new Error(clientError.message);
  const { data: report, error } = await supabaseAdmin
    .from('reports')
    .select('id, client_id, helper_id, status, deleted_at')
    .eq('id', reportId)
    .in('client_id', (clients || []).map((client) => client.id))
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !report) throw new Error('記録にアクセスできません');

  if (role === 'member' && report.helper_id !== userId) {
    await assertStaffAssignment(userId, report.client_id);
  }
  return { userId, role, report };
}

export async function uploadReportImage(formData: FormData) {
  const organizationId = String(formData.get('organizationId') || '');
  const reportId = String(formData.get('reportId') || '');
  const file = formData.get('file');
  if (!(file instanceof File)) throw new Error('画像ファイルがありません');

  const { userId, role, report } = await getAccessibleReport(organizationId, reportId);
  if (report.status === 'approved') throw new Error('承認済み記録へ画像を追加できません');
  if (role === 'member' && report.helper_id !== userId) {
    throw new Error('他の職員が作成した記録へ画像を追加できません');
  }

  const sanitized = await sanitizeUploadedImage(file);

  const storagePath = `${organizationId}/${reportId}/${randomUUID()}.${sanitized.extension}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from('report-images')
    .upload(storagePath, sanitized.bytes, {
      contentType: sanitized.contentType,
      upsert: false,
      cacheControl: '0',
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data: image, error: insertError } = await supabaseAdmin
    .from('report_images')
    .insert({ report_id: reportId, storage_path: storagePath })
    .select('id')
    .single();
  if (insertError || !image) {
    await supabaseAdmin.storage.from('report-images').remove([storagePath]);
    throw new Error(insertError?.message || '画像情報を保存できませんでした');
  }

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'report_image.upload',
    resourceType: 'report',
    resourceId: reportId,
    sessionId: (await getAuthedUser()).sessionId,
    details: { imageId: image.id, originalContentType: file.type, storedContentType: sanitized.contentType, originalSize: file.size, storedSize: sanitized.bytes.length },
  });
  return { success: true, imageId: image.id };
}

export async function getReportImages(organizationId: string, reportId: string) {
  const { userId } = await getAccessibleReport(organizationId, reportId);
  const { data: images, error } = await supabaseAdmin
    .from('report_images')
    .select('id, storage_path')
    .eq('report_id', reportId);
  if (error) throw sanitizeDbError(error, 'action.reports');

  const signedImages = await Promise.all((images || []).map(async (image) => {
    const { data, error: signedError } = await supabaseAdmin.storage
      .from('report-images')
      .createSignedUrl(image.storage_path, 300);
    if (signedError) throw new Error(signedError.message);
    return { id: image.id, url: data.signedUrl };
  }));

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'report_image.view',
    resourceType: 'report',
    resourceId: reportId,
    details: { imageCount: signedImages.length },
  });
  return signedImages;
}

export async function auditReportView(organizationId: string, reportId: string) {
  const { userId } = await getAccessibleReport(organizationId, reportId);
  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: 'report.view',
    resourceType: 'report',
    resourceId: reportId,
  });
}

export async function auditReportExport(
  organizationId: string,
  reportIds: string[],
  format: 'csv' | 'pdf',
) {
  const ids = Array.from(new Set(reportIds.filter(Boolean)));
  if (ids.length === 0 || ids.length > 1000) throw new Error('出力対象件数が不正です');
  const { userId } = await assertOrgPermission(organizationId, 'reports');
  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: `report.export_${format}`,
    resourceType: 'report',
    details: { reportIds: ids, count: ids.length, format },
  });
}
