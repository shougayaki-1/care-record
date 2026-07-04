import { NextRequest, NextResponse } from 'next/server';
import { getActiveOrganizationIds, exportReportsAsCsv } from '@/utils/gcs/export';
import { isGcsBackupConfigured, uploadToGCS } from '@/utils/gcs/upload';
import { generateBackupHtml } from '@/utils/gcs/html';
import { recordAuditEvent } from '@/utils/supabase/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  return (
    !!process.env.CRON_SECRET &&
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  );
}

/** 監査ログへ記録できなくても本処理自体は継続させるためのbest-effortラッパー */
async function logBackupRun(params: { organizationId: string | null; outcome: 'success' | 'failure'; details: Record<string, unknown> }) {
  try {
    await recordAuditEvent({
      organizationId: params.organizationId,
      actorId: null,
      action: 'backup.cron_run',
      resourceType: 'backup',
      outcome: params.outcome,
      details: params.details,
    });
  } catch (e) {
    console.error('[cron:backup-daily] failed to record audit event', e);
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    await logBackupRun({ organizationId: null, outcome: 'failure', details: { reason: 'unauthorized' } });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isGcsBackupConfigured()) {
    await logBackupRun({ organizationId: null, outcome: 'failure', details: { reason: 'gcs_not_configured' } });
    return NextResponse.json({ ok: false, error: 'gcs_not_configured' }, { status: 500 });
  }

  const bucket = 'care-record-search-daily';
  const now = new Date();
  const today = formatTokyoDate(now);
  const version = formatTokyoTime(now).replace(/:/g, '-');

  try {
    const orgIds = await getActiveOrganizationIds();
    let succeeded = 0;
    let empty = 0;

    for (const orgId of orgIds) {
      try {
        const csv = await exportReportsAsCsv(orgId);
        const rows = csvToHtmlRows(csv);
        const html = generateBackupHtml(today, rows);

        await Promise.all([
          uploadToGCS(bucket, `daily/${orgId}/${today}/${version}.csv`, csv),
          uploadToGCS(bucket, `daily/${orgId}/${today}/${version}.html`, html),
        ]);
        succeeded++;
        if (rows.length === 0) empty++;
        await logBackupRun({ organizationId: orgId, outcome: 'success', details: { records: rows.length, empty: rows.length === 0, date: today } });
      } catch (orgErr) {
        console.error('[cron:backup-daily] org failed', orgId, orgErr);
        await logBackupRun({ organizationId: orgId, outcome: 'failure', details: { date: today, reason: orgErr instanceof Error ? orgErr.message : 'unknown' } });
      }
    }

    return NextResponse.json({ ok: true, orgs: succeeded, empty, date: today });
  } catch (err) {
    console.error('[cron:backup-daily]', err);
    await logBackupRun({ organizationId: null, outcome: 'failure', details: { date: today, reason: err instanceof Error ? err.message : 'unknown' } });
    return NextResponse.json({ ok: false, error: 'backup_failed' }, { status: 500 });
  }
}

function csvToHtmlRows(csv: string) {
  const lines = csv.split('\n');
  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cols = parseCsvLine(line);
    return [{ id: cols[0] ?? '', clientName: cols[1] ?? '', startAt: cols[2] ?? '', endAt: cols[3] ?? '', helperName: cols[4] ?? '', status: cols[5] ?? '' }];
  });
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { cols.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  cols.push(cur);
  return cols;
}

export async function POST(request: NextRequest) {
  return GET(request);
}

function formatTokyoDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatTokyoTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
