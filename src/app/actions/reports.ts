'use server';

import { sanitizeDbError } from '@/utils/errors';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgPermission, assertOrgRole, assertRecordPermission, createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { randomUUID } from 'crypto';
import { sanitizeUploadedImage } from '@/utils/uploadSecurity';
import { MODEL_NAME } from '@/lib/ai/model';

type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';

export type MyReportHistoryResult = {
  status: 'ok' | 'staff_mapping_missing';
  items: Array<{
    id: string;
    start_at: string;
    status: 'pending' | 'approved' | 'remanded';
    client_id: string;
    clients: { name: string } | null;
  }>;
};

/** Returns only reports where the logged-in user is an actual service staff.
 * `helper_id` is the report author, so it must not be used for this view. */
export async function getMyReportHistory(
  organizationId: string,
  options: { startAt?: string; endAt?: string; limit?: number } = {},
): Promise<MyReportHistoryResult> {
  const { userId } = await assertOrgRole(organizationId);
  const supabase = await createSessionClient();
  const { data: staff, error: staffError } = await supabase
    .from('staffs')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (staffError) throw sanitizeDbError(staffError, 'action.reports');
  if (!staff) return { status: 'staff_mapping_missing', items: [] };

  let query = supabase
    .from('reports')
    .select('id, start_at, status, client_id, clients!inner(name, organization_id), report_actual_staffs!inner(staff_id)')
    .eq('clients.organization_id', organizationId)
    .eq('report_actual_staffs.staff_id', staff.id)
    .is('deleted_at', null)
    .neq('status', 'draft')
    .order('start_at', { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 100));
  if (options.startAt) query = query.gte('start_at', options.startAt);
  if (options.endAt) query = query.lt('start_at', options.endAt);
  const { data, error } = await query;
  if (error) throw sanitizeDbError(error, 'action.reports');
  return {
    status: 'ok',
    items: (data ?? []).map((report) => ({
      id: report.id,
      start_at: report.start_at,
      status: report.status as 'pending' | 'approved' | 'remanded',
      client_id: report.client_id,
      clients: Array.isArray(report.clients) ? (report.clients[0] ?? null) : report.clients,
    })),
  };
}

export type SaveReportInput = {
  organizationId: string;
  reportId?: string | null;
  clientId: string;
  shiftId?: string | null;
  segmentId?: string | null;
  actualServiceTypeId?: string | null;
  actualStaffs?: { staff_id: string; staff_role_id?: string | null }[];
  startAt: string;
  endAt: string;
  status: ReportStatus;
  values: Record<string, unknown>;
  expectedVersion: number;
  idempotencyKey: string;
  correctionReason?: string | null;
  auditSource?: 'ai_import';
  auditModel?: string;
  auditFileCount?: number;
};

export type ReportAutosaveInput = {
  organizationId: string;
  clientId: string;
  reportId?: string | null;
  draftKey: string;
  baseContentRevision?: number | null;
  autosaveRevision: number;
  payload: Record<string, unknown>;
};

/** Stores private, recoverable form state without changing a submitted report. */
export async function saveReportAutosave(input: ReportAutosaveInput) {
  await assertRecordPermission(input.organizationId, 'edit', {
    clientId: input.clientId,
    reportId: input.reportId || null,
  });
  if (!/^[0-9a-f-]{36}$/i.test(input.draftKey)) throw new Error('下書き識別子が不正です');
  if (!Number.isInteger(input.autosaveRevision) || input.autosaveRevision < 0) throw new Error('自動保存の版番号が不正です');
  if (JSON.stringify(input.payload).length > 1_000_000) throw new Error('自動保存の内容が大きすぎます');
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc('save_report_autosave_authorized', {
    p_organization_id: input.organizationId, p_client_id: input.clientId,
    p_report_id: input.reportId || null, p_draft_key: input.draftKey,
    p_base_content_revision: input.baseContentRevision ?? null,
    p_autosave_revision: input.autosaveRevision, p_payload: input.payload,
  });
  if (error) throw sanitizeDbError(error, 'action.reports');
  return data as { saved: boolean; stale: boolean; savedAt: string | null };
}

export async function loadReportAutosave(organizationId: string, draftKey: string) {
  await assertOrgRole(organizationId);
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc('load_report_autosave_authorized', { p_organization_id: organizationId, p_draft_key: draftKey });
  if (error) throw sanitizeDbError(error, 'action.reports');
  if (data) {
    await assertRecordPermission(organizationId, 'edit', { clientId: data.client_id, reportId: data.report_id });
  }
  return data;
}

export async function discardReportAutosave(organizationId: string, draftKey: string) {
  await assertOrgRole(organizationId);
  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('discard_report_autosave_authorized', { p_organization_id: organizationId, p_draft_key: draftKey });
  if (error) throw sanitizeDbError(error, 'action.reports');
  return { success: true };
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
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new Error('記録の版番が不正です');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new Error('冗等性キーが不正です');
  }
  const { data: saved, error } = await supabase.rpc('save_report_versioned', {
    p_organization_id: input.organizationId,
    p_report_id: input.reportId || null,
    p_client_id: input.clientId,
    p_shift_id: input.shiftId || null,
    p_segment_id: input.segmentId || null,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
    p_status: input.status,
    p_values: input.values,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
    p_session_id: user.sessionId,
    p_actual_service_type_id: input.actualServiceTypeId || null,
    p_actual_staffs: input.actualStaffs ?? [],
    p_correction_reason: input.correctionReason?.trim() || null,
  });
  if (error || !saved) {
    await recordAuditEvent({ organizationId: input.organizationId, actorId: user.id, action: 'report.save',
      resourceType: 'report', resourceId: input.reportId || null, outcome: 'failure', sessionId: user.sessionId,
      details: { attemptedStatus: input.status, errorType: error?.code || 'unknown' },
    });
    if (error?.code === 'CR409') {
      throw new Error(`REPORT_VERSION_CONFLICT:${error.message}`);
    }
    throw sanitizeDbError(error || new Error('記録を保存できませんでした'), 'action.reports');
  }
  const result = saved as unknown as { recordId: string; revisionId: string; version: number; replayed: boolean };
  const savedReportId = String(result.recordId);

  if (input.status === 'draft' && input.auditSource === 'ai_import') {
    await recordAuditEvent({
      organizationId: input.organizationId,
      actorId: user.id,
      action: 'ai_draft.created',
      resourceType: 'report',
      resourceId: savedReportId,
      sessionId: user.sessionId,
      details: {
        source: 'ai_import',
        model: input.auditModel || MODEL_NAME,
        file_count: input.auditFileCount ?? 1,
      },
    });
  }
  return { success: true, reportId: savedReportId, revisionId: result.revisionId, version: result.version, replayed: result.replayed };
}

export async function transitionReports(
  organizationId: string,
  reportIds: string[],
  transition: 'approve' | 'remand',
) {
  const ids = Array.from(new Set(reportIds.filter(Boolean)));
  if (ids.length === 0 || ids.length > 100) throw new Error('対象件数が不正です');
  await assertOrgPermission(organizationId, 'reports');
  const { userId } = await assertRecordPermission(organizationId, 'approve', { reportIds: ids });

  const supabase = await createSessionClient();
  const { error: updateError } = await supabase.rpc('transition_reports_authorized', {
    p_organization_id: organizationId, p_report_ids: ids, p_transition: transition,
  });
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

  const { userId } = await assertRecordPermission(organizationId, 'delete', { reportIds: uniqueIds, includeDeleted: true });
  const supabase = await createSessionClient();
  const { data: deletionResult, error: updateError } = await supabase.rpc('soft_delete_reports_authorized', {
    p_organization_id: organizationId, p_report_ids: uniqueIds,
    p_reason: normalizedReason,
  });
  if (updateError) throw new Error(updateError.message);
  const result = deletionResult && typeof deletionResult === 'object' && !Array.isArray(deletionResult)
    ? deletionResult as Record<string, unknown>
    : {};
  const retentionUntil = typeof result.retentionUntil === 'string' ? result.retentionUntil : '';
  const legalBasis = typeof result.legalBasis === 'string' ? result.legalBasis : '';
  if (!retentionUntil || !legalBasis) throw new Error('保持方針の適用結果を確認できませんでした');

  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: uniqueIds.length === 1 ? 'report.soft_delete' : 'report.bulk_soft_delete',
    resourceType: 'report',
    resourceId: uniqueIds.length === 1 ? uniqueIds[0] : null,
    reason: normalizedReason,
    details: { reportIds: uniqueIds, count: uniqueIds.length, legalBasis },
  });

  return { success: true, deleted: uniqueIds.length, retentionUntil };
}

export async function restoreReports(organizationId: string, reportIds: string[]) {
  const uniqueIds = Array.from(new Set(reportIds.filter(Boolean)));
  if (uniqueIds.length === 0 || uniqueIds.length > 100) {
    throw new Error('復元対象の件数が不正です');
  }
  await assertOrgPermission(organizationId, 'reports');
  const { userId } = await assertRecordPermission(organizationId, 'delete', { reportIds: uniqueIds, includeDeleted: true });

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc('restore_reports_authorized', { p_organization_id: organizationId, p_report_ids: uniqueIds });
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

async function getAccessibleReport(organizationId: string, reportId: string, action: 'view' | 'edit' = 'view') {
  const { userId } = await assertRecordPermission(organizationId, action, { reportId });
  const supabase = await createSessionClient();
  const { data: report, error } = await supabase
    .from('reports')
    .select('id, client_id, helper_id, status, deleted_at')
    .eq('id', reportId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !report) throw new Error('記録にアクセスできません');

  return { userId, report };
}

export async function uploadReportImage(formData: FormData) {
  const organizationId = String(formData.get('organizationId') || '');
  const reportId = String(formData.get('reportId') || '');
  const file = formData.get('file');
  if (!(file instanceof File)) throw new Error('画像ファイルがありません');

  const { userId, report } = await getAccessibleReport(organizationId, reportId, 'edit');
  if (report.status === 'approved') throw new Error('承認済み記録へ画像を追加できません');

  const sessionClient = await createSessionClient();
  const { data: reservationId, error: reserveError } = await sessionClient.rpc('reserve_report_image_upload', { p_report_id: reportId });
  if (reserveError?.message.includes('report_image_limit_exceeded')) throw new Error('画像は1記録あたり20件までです');
  if (reserveError?.message.includes('report_image_rate_limited')) throw new Error('画像アップロードは1分あたり10件までです');
  if (reserveError) throw sanitizeDbError(reserveError, 'action.reports.reserve-image-upload');
  if (typeof reservationId !== 'string') throw new Error('画像アップロード予約を作成できませんでした');

  let completed = false;
  let storagePath: string | undefined;
  try {
    const sanitized = await sanitizeUploadedImage(file);

    storagePath = `${organizationId}/${reportId}/${randomUUID()}.${sanitized.extension}`;
    const { error: uploadError } = await sessionClient.storage
      .from('report-images')
      .upload(storagePath, sanitized.bytes, {
        contentType: sanitized.contentType,
        upsert: false,
        cacheControl: '0',
      });
    if (uploadError) throw new Error(uploadError.message);

    const { data: image, error: insertError } = await sessionClient
      .from('report_images')
      .insert({ report_id: reportId, storage_path: storagePath })
      .select('id')
      .single();
    if (insertError || !image) {
      await sessionClient.storage.from('report-images').remove([storagePath]);
      storagePath = undefined;
      throw new Error(insertError?.message || '画像情報を保存できませんでした');
    }

    const { error: finishError } = await sessionClient.rpc('finish_report_image_upload', {
      p_reservation_id: reservationId,
      p_completed: true,
    });
    if (finishError) throw sanitizeDbError(finishError, 'action.reports.finish-image-upload');
    completed = true;

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
  } finally {
    if (!completed) {
      await sessionClient.rpc('finish_report_image_upload', {
        p_reservation_id: reservationId,
        p_completed: false,
      });
    }
  }
}

export async function getReportImages(organizationId: string, reportId: string) {
  const { userId } = await getAccessibleReport(organizationId, reportId, 'view');
  const sessionClient = await createSessionClient();
  const { data: images, error } = await sessionClient
    .from('report_images')
    .select('id, storage_path')
    .eq('report_id', reportId);
  if (error) throw sanitizeDbError(error, 'action.reports');

  const signedImages = await Promise.all((images || []).map(async (image) => {
    const { data, error: signedError } = await sessionClient.storage
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
  const { userId } = await getAccessibleReport(organizationId, reportId, 'view');
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
