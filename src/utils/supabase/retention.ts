import 'server-only';

import { supabaseAdmin } from './auth';

// 保持期間（retention_until）を過ぎた論理削除済みレコードを物理消去する。
// 3省2ガイドライン: 適切な保持期間管理。消去の事実は audit_events に残す。

// 1回の実行で処理する上限。Vercel Hobby の関数実行時間制限内に収めるための安全策。
// 日次実行なので、上限に達した分は翌日以降の実行で順次消化される。
const MAX_REPORTS_PER_RUN = 200;
const MAX_ENTITIES_PER_RUN = 200;

type PurgeSummary = {
  reports: number;
  clients: number;
  staffs: number;
  shifts: number;
  organizations: number;
  storageObjects: number;
  dryRun: boolean;
  // 上限に達し、未処理の対象が残っている可能性があるか。
  more: boolean;
};

async function recordPurgeAudit(
  organizationId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, unknown>,
): Promise<void> {
  // headers() に依存しないシステムジョブ用の直接挿入（recordAuditEvent はリクエスト文脈前提のため）。
  await supabaseAdmin.from('audit_events').insert({
    organization_id: organizationId,
    actor_id: null,
    action_type: action,
    resource_type: resourceType,
    resource_id: resourceId,
    outcome: 'success',
    details,
  });
}

export async function purgeExpiredRecords(dryRun = false): Promise<PurgeSummary> {
  const nowIso = new Date().toISOString();
  const summary: PurgeSummary = { reports: 0, clients: 0, staffs: 0, shifts: 0, organizations: 0, storageObjects: 0, dryRun, more: false };

  // 1) 期限切れの論理削除済みレポート: 画像実体 → 子レコード → 本体 の順で消す。
  const { data: reports } = await supabaseAdmin
    .from('reports')
    .select('id, client_id, clients!inner(organization_id)')
    .not('deleted_at', 'is', null)
    .is('legal_hold_at', null)
    .lte('retention_until', nowIso)
    .limit(MAX_REPORTS_PER_RUN);
  if ((reports?.length ?? 0) >= MAX_REPORTS_PER_RUN) summary.more = true;

  for (const report of reports ?? []) {
    const { data: images } = await supabaseAdmin
      .from('report_images')
      .select('storage_path')
      .eq('report_id', report.id);
    const paths = (images ?? []).map((i: { storage_path: string }) => i.storage_path).filter(Boolean);

    if (!dryRun) {
      if (paths.length) {
        await supabaseAdmin.storage.from('report-images').remove(paths);
      }
      await supabaseAdmin.from('report_images').delete().eq('report_id', report.id);
      await supabaseAdmin.from('report_values').delete().eq('report_id', report.id);
      await supabaseAdmin.from('reports').delete().eq('id', report.id);
      const client = Array.isArray(report.clients) ? report.clients[0] : report.clients;
      await recordPurgeAudit(client?.organization_id ?? null, 'report.purge', 'report', report.id, { images: paths.length });
    }
    summary.reports += 1;
    summary.storageObjects += paths.length;
  }

  // 2) 期限切れの論理削除済み利用者・スタッフ。
  for (const table of ['clients', 'staffs'] as const) {
    const { data: rows } = await supabaseAdmin
      .from(table)
      .select('id, organization_id')
      .not('deleted_at', 'is', null)
      .lte('retention_until', nowIso)
      .limit(MAX_ENTITIES_PER_RUN);
    if ((rows?.length ?? 0) >= MAX_ENTITIES_PER_RUN) summary.more = true;
    for (const row of rows ?? []) {
      if (!dryRun) {
        await supabaseAdmin.from(table).delete().eq('id', row.id);
        await recordPurgeAudit(row.organization_id ?? null, `${table === 'clients' ? 'client' : 'staff'}.purge`, table, row.id, {});
      }
      if (table === 'clients') summary.clients += 1; else summary.staffs += 1;
    }
  }

  // 3) 期限切れシフト。リーガルホールド中は消去しない。
  const { data: shifts } = await supabaseAdmin.from('shifts').select('id, organization_id')
    .not('deleted_at', 'is', null).is('legal_hold_at', null).lte('retention_until', nowIso).limit(MAX_ENTITIES_PER_RUN);
  if ((shifts?.length ?? 0) >= MAX_ENTITIES_PER_RUN) summary.more = true;
  for (const shift of shifts ?? []) {
    if (!dryRun) {
      const { error } = await supabaseAdmin.from('shifts').delete().eq('id', shift.id);
      if (error) throw error;
      await recordPurgeAudit(shift.organization_id, 'shift.purge', 'shift', shift.id, {});
    }
    summary.shifts += 1;
  }

  // 4) レート制限・nonce・失効済みセッション等の一時データを掃除する。
  if (!dryRun) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from('login_attempts').delete().lt('created_at', cutoff);
    await supabaseAdmin.from('oauth_nonces').delete().lt('expires_at', nowIso);
    await supabaseAdmin.from('user_session_activity').delete().lt('absolute_expires_at', nowIso);
  }

  return summary;
}
