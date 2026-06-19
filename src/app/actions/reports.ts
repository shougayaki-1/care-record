'use server';

import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgRole, supabaseAdmin } from '@/utils/supabase/auth';
import { randomUUID } from 'crypto';

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

async function assertClientInOrganization(clientId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('organization_id', organizationId)
    .single();
  if (error || !data) throw new Error('利用者が対象事業所に所属していません');
}

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
  const { userId, role } = await assertOrgRole(input.organizationId);
  await assertClientInOrganization(input.clientId, input.organizationId);
  if (role === 'staff') await assertStaffAssignment(userId, input.clientId);

  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
    throw new Error('開始・終了日時が不正です');
  }
  if (JSON.stringify(input.values).length > 1_000_000) {
    throw new Error('記録内容が大きすぎます');
  }
  if (['approved', 'remanded'].includes(input.status) && role === 'staff') {
    throw new Error('承認・差戻しは管理者のみ実行できます');
  }

  if (input.shiftId) {
    const { data: shift } = await supabaseAdmin
      .from('shifts')
      .select('id')
      .eq('id', input.shiftId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    if (!shift) throw new Error('対象シフトが事業所に所属していません');
  }

  const now = new Date().toISOString();
  let reportId = input.reportId || null;
  let previousStatus: string | null = null;

  if (reportId) {
    const { data: existing, error } = await supabaseAdmin
      .from('reports')
      .select('id, client_id, helper_id, status, deleted_at')
      .eq('id', reportId)
      .maybeSingle();
    if (error || !existing || existing.client_id !== input.clientId || existing.deleted_at) {
      throw new Error('更新対象の記録が見つかりません');
    }
    if (role === 'staff' && existing.helper_id !== userId) {
      throw new Error('他の職員が作成した記録は更新できません');
    }
    if (existing.status === 'approved' && input.status !== 'remanded') {
      throw new Error('承認済み記録は直接編集できません');
    }
    previousStatus = existing.status;

    const updatePayload: Record<string, unknown> = {
      start_at: input.startAt,
      end_at: input.endAt,
      status: input.status,
      shift_id: input.shiftId || null,
      updated_at: now,
    };
    if (input.status === 'approved') {
      updatePayload.approved_by = userId;
      updatePayload.approved_at = now;
    } else if (input.status === 'remanded') {
      updatePayload.approved_by = null;
      updatePayload.approved_at = null;
    }
    const { error: updateError } = await supabaseAdmin.from('reports').update(updatePayload).eq('id', reportId);
    if (updateError) throw new Error(updateError.message);

    const { data: reportValue } = await supabaseAdmin
      .from('report_values')
      .select('report_id')
      .eq('report_id', reportId)
      .maybeSingle();
    const valuesQuery = reportValue
      ? supabaseAdmin.from('report_values').update({ data: input.values }).eq('report_id', reportId)
      : supabaseAdmin.from('report_values').insert({ report_id: reportId, data: input.values });
    const { error: valuesError } = await valuesQuery;
    if (valuesError) throw new Error(valuesError.message);
  } else {
    if (['approved', 'remanded'].includes(input.status)) {
      throw new Error('新規記録は下書きまたは未承認として保存してください');
    }
    const { data: created, error } = await supabaseAdmin
      .from('reports')
      .insert({
        client_id: input.clientId,
        helper_id: userId,
        start_at: input.startAt,
        end_at: input.endAt,
        status: input.status,
        shift_id: input.shiftId || null,
        updated_at: now,
      })
      .select('id')
      .single();
    if (error || !created) throw new Error(error?.message || '記録を作成できませんでした');
    reportId = created.id;
    const { error: valuesError } = await supabaseAdmin
      .from('report_values')
      .insert({ report_id: reportId, data: input.values });
    if (valuesError) throw new Error(valuesError.message);
  }

  await recordAuditEvent({
    organizationId: input.organizationId,
    actorId: userId,
    action: input.reportId ? `report.${input.status}` : 'report.create',
    resourceType: 'report',
    resourceId: reportId,
    details: { previousStatus, newStatus: input.status },
  });
  return { success: true, reportId };
}

export async function transitionReports(
  organizationId: string,
  reportIds: string[],
  transition: 'approve' | 'remand',
) {
  const ids = Array.from(new Set(reportIds.filter(Boolean)));
  if (ids.length === 0 || ids.length > 100) throw new Error('対象件数が不正です');
  const { userId } = await assertOrgRole(organizationId, ['owner', 'manager']);

  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients').select('id').eq('organization_id', organizationId);
  if (clientError) throw new Error(clientError.message);
  const { data: reports, error } = await supabaseAdmin
    .from('reports')
    .select('id, status')
    .in('id', ids)
    .in('client_id', (clients || []).map((client) => client.id))
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);

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
  if (role === 'staff' && reports.some((report) =>
    report.helper_id !== userId || !['draft', 'remanded'].includes(report.status)
  )) {
    throw new Error('自分の下書きまたは差戻し記録だけ削除できます');
  }

  const { data: organization, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('retention_years')
    .eq('id', organizationId)
    .single();
  if (orgError) throw new Error(orgError.message);

  const deletedAt = new Date();
  const retentionUntil = new Date(deletedAt);
  retentionUntil.setUTCFullYear(retentionUntil.getUTCFullYear() + (organization.retention_years || 5));

  const { error: updateError } = await supabaseAdmin
    .from('reports')
    .update({
      deleted_at: deletedAt.toISOString(),
      deleted_by: userId,
      deletion_reason: normalizedReason,
      retention_until: retentionUntil.toISOString(),
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
    details: { reportIds: uniqueIds, count: uniqueIds.length, reason: normalizedReason },
  });

  return { success: true, deleted: uniqueIds.length, retentionUntil: retentionUntil.toISOString() };
}

export async function restoreReports(organizationId: string, reportIds: string[]) {
  const uniqueIds = Array.from(new Set(reportIds.filter(Boolean)));
  if (uniqueIds.length === 0 || uniqueIds.length > 100) {
    throw new Error('復元対象の件数が不正です');
  }
  const { userId } = await assertOrgRole(organizationId, ['owner', 'manager']);

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
  if (error) throw new Error(error.message);

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

  if (role === 'staff' && report.helper_id !== userId) {
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
  if (role === 'staff' && report.helper_id !== userId) {
    throw new Error('他の職員が作成した記録へ画像を追加できません');
  }

  const allowedTypes = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ]);
  const extension = allowedTypes.get(file.type);
  if (!extension) throw new Error('JPEG、PNG、WebP画像のみアップロードできます');
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('画像サイズは10MB以下にしてください');
  }

  const storagePath = `${organizationId}/${reportId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from('report-images')
    .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
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
    details: { imageId: image.id, contentType: file.type, size: file.size },
  });
  return { success: true, imageId: image.id };
}

export async function getReportImages(organizationId: string, reportId: string) {
  const { userId } = await getAccessibleReport(organizationId, reportId);
  const { data: images, error } = await supabaseAdmin
    .from('report_images')
    .select('id, storage_path')
    .eq('report_id', reportId);
  if (error) throw new Error(error.message);

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
  const { userId } = await assertOrgRole(organizationId, ['owner', 'manager']);
  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: `report.export_${format}`,
    resourceType: 'report',
    details: { reportIds: ids, count: ids.length, format },
  });
}
