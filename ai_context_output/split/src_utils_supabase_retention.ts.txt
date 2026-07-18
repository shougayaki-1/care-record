import 'server-only';

import { serviceRoleForRetentionDryRun } from './serviceRole';

const supabaseAdmin = serviceRoleForRetentionDryRun();

// 初期提供では保持期間を過ぎた候補を集計するだけで、物理削除経路を持たない。

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

export async function purgeExpiredRecords(dryRun = true): Promise<PurgeSummary> {
  if (!dryRun) {
    throw new Error('Physical deletion is disabled in the purge cron path');
  }
  const nowIso = new Date().toISOString();
  const summary: PurgeSummary = { reports: 0, clients: 0, staffs: 0, shifts: 0, organizations: 0, storageObjects: 0, dryRun, more: false };

  // 1) 期限切れの論理削除済みレポートと関連画像を集計。
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
      void row;
      if (table === 'clients') summary.clients += 1; else summary.staffs += 1;
    }
  }

  // 3) 期限切れシフト。リーガルホールド中は消去しない。
  const { data: shifts } = await supabaseAdmin.from('shifts').select('id, organization_id')
    .not('deleted_at', 'is', null).is('legal_hold_at', null).lte('retention_until', nowIso).limit(MAX_ENTITIES_PER_RUN);
  if ((shifts?.length ?? 0) >= MAX_ENTITIES_PER_RUN) summary.more = true;
  for (const shift of shifts ?? []) {
    void shift;
    summary.shifts += 1;
  }

  return summary;
}
