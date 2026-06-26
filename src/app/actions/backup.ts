'use server';

import { assertOrgPermission } from '@/utils/supabase/auth';
import { listGCSFiles, readGCSFile, uploadToGCS } from '@/utils/gcs/upload';
import { exportReportsAsCsv } from '@/utils/gcs/export';
import { generateBackupHtml } from '@/utils/gcs/html';

const DAILY_BUCKET = 'care-record-search-daily';

export type BackupFileEntry = {
  date: string;
  path: string;
  updated: string;
  size: number;
};

export type BackupRecord = {
  id: string;
  clientName: string;
  startAt: string;
  endAt: string;
  helperName: string;
  status: string;
};

function isGcsConfigured(): boolean {
  return !!(process.env.GCP_PROJECT_ID && process.env.GCP_SERVICE_ACCOUNT_KEY_JSON);
}

export type ListDailyBackupsResult =
  | { configured: false }
  | { configured: true; files: BackupFileEntry[] };

export async function listDailyBackups(orgId: string): Promise<ListDailyBackupsResult> {
  await assertOrgPermission(orgId, 'auditLogs');

  if (!isGcsConfigured()) return { configured: false };

  const prefix = `daily/${orgId}/`;
  const files = await listGCSFiles(DAILY_BUCKET, prefix);

  return {
    configured: true,
    files: files
      .filter((f) => f.name.endsWith('.csv'))
      .map((f) => {
        const dateMatch = f.name.match(/(\d{4}-\d{2}-\d{2})\.csv$/);
        return {
          date: dateMatch?.[1] ?? f.name,
          path: f.name,
          updated: f.updated,
          size: f.size,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export async function getBackupRecords(orgId: string, date: string): Promise<BackupRecord[]> {
  await assertOrgPermission(orgId, 'auditLogs');
  if (!isGcsConfigured()) throw new Error('GCS_NOT_CONFIGURED');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付形式が不正です');

  const path = `daily/${orgId}/${date}.csv`;
  const csv = await readGCSFile(DAILY_BUCKET, path);

  const lines = csv.split('\n');
  if (lines.length < 2) return [];

  return lines.slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cols = parseCsvLine(line);
    return [{
      id: cols[0] ?? '',
      clientName: cols[1] ?? '',
      startAt: cols[2] ?? '',
      endAt: cols[3] ?? '',
      helperName: cols[4] ?? '',
      status: cols[5] ?? '',
    }];
  });
}

export async function triggerDailyBackup(orgId: string): Promise<{ date: string; records: number }> {
  await assertOrgPermission(orgId, 'auditLogs');
  if (!isGcsConfigured()) throw new Error('GCS_NOT_CONFIGURED');

  const date = new Date().toISOString().split('T')[0];
  const csv = await exportReportsAsCsv(orgId);

  if (!csv) {
    await uploadToGCS(DAILY_BUCKET, `daily/${orgId}/${date}.csv`, '');
    return { date, records: 0 };
  }

  const rows = csv.split('\n').slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cols = parseCsvLine(line);
    return [{ id: cols[0] ?? '', clientName: cols[1] ?? '', startAt: cols[2] ?? '', endAt: cols[3] ?? '', helperName: cols[4] ?? '', status: cols[5] ?? '' }];
  });

  const html = generateBackupHtml(date, rows);

  await Promise.all([
    uploadToGCS(DAILY_BUCKET, `daily/${orgId}/${date}.csv`, csv),
    uploadToGCS(DAILY_BUCKET, `daily/${orgId}/${date}.html`, html),
  ]);

  return { date, records: rows.length };
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
