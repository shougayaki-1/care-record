'use server';

import { assertOrgPermission } from '@/utils/supabase/auth';
import { isGcsBackupConfigured, listGCSFiles, readGCSFile, uploadToGCS } from '@/utils/gcs/upload';
import { exportReportsAsCsv } from '@/utils/gcs/export';
import { generateBackupHtml } from '@/utils/gcs/html';

const DAILY_BUCKET = 'care-record-search-daily';

export type BackupFileEntry = {
  date: string;
  path: string;
  updated: string;
  size: number;
  label: string;
};

export type BackupRecord = {
  id: string;
  clientName: string;
  startAt: string;
  endAt: string;
  helperName: string;
  status: string;
  values: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type ListDailyBackupsResult =
  | { configured: false }
  | { configured: true; files: BackupFileEntry[] };

export async function listDailyBackups(orgId: string): Promise<ListDailyBackupsResult> {
  await assertOrgPermission(orgId, 'auditLogs');

  if (!isGcsBackupConfigured()) return { configured: false };

  const prefix = `daily/${orgId}/`;
  const files = await listGCSFiles(DAILY_BUCKET, prefix);

  return {
    configured: true,
    files: files
      .filter((f) => f.name.endsWith('.csv'))
      .flatMap((f) => {
        const legacyMatch = f.name.match(/\/(\d{4}-\d{2}-\d{2})\.csv$/);
        const versionedMatch = f.name.match(/\/(\d{4}-\d{2}-\d{2})\/([^/]+)\.csv$/);
        const date = versionedMatch?.[1] ?? legacyMatch?.[1];
        if (!date) return [];
        return {
          date,
          path: f.name,
          updated: f.updated,
          size: f.size,
          label: formatBackupFileLabel(f.name, f.updated),
        };
      })
      .sort((a, b) => b.updated.localeCompare(a.updated)),
  };
}

export async function getBackupRecords(orgId: string, filePath: string): Promise<BackupRecord[]> {
  await assertOrgPermission(orgId, 'auditLogs');
  if (!isGcsBackupConfigured()) throw new Error('GCS_NOT_CONFIGURED');

  const path = resolveBackupFilePath(orgId, filePath);
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
      values: parseJsonCell(cols[6]),
      createdAt: cols[7] ?? '',
      updatedAt: cols[8] ?? '',
    }];
  });
}

export async function triggerDailyBackup(orgId: string): Promise<{ date: string; path: string; records: number }> {
  await assertOrgPermission(orgId, 'auditLogs');
  if (!isGcsBackupConfigured()) throw new Error('GCS_NOT_CONFIGURED');

  const now = new Date();
  const date = formatTokyoDate(now);
  const version = formatTokyoTime(now).replace(/:/g, '-');
  const csvPath = `daily/${orgId}/${date}/${version}.csv`;
  const htmlPath = `daily/${orgId}/${date}/${version}.html`;
  const csv = await exportReportsAsCsv(orgId);

  if (!csv) {
    await uploadToGCS(DAILY_BUCKET, csvPath, '');
    return { date, path: csvPath, records: 0 };
  }

  const rows = csv.split('\n').slice(1).flatMap((line) => {
    if (!line.trim()) return [];
    const cols = parseCsvLine(line);
    return [{ id: cols[0] ?? '', clientName: cols[1] ?? '', startAt: cols[2] ?? '', endAt: cols[3] ?? '', helperName: cols[4] ?? '', status: cols[5] ?? '' }];
  });

  const html = generateBackupHtml(date, rows);

  await Promise.all([
    uploadToGCS(DAILY_BUCKET, csvPath, csv),
    uploadToGCS(DAILY_BUCKET, htmlPath, html),
  ]);

  return { date, path: csvPath, records: rows.length };
}

function resolveBackupFilePath(orgId: string, input: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `daily/${orgId}/${input}.csv`;
  const prefix = `daily/${orgId}/`;
  if (!input.startsWith(prefix) || !input.endsWith('.csv') || input.includes('..')) {
    throw new Error('バックアップファイルの指定が不正です');
  }
  return input;
}

function parseJsonCell(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function formatBackupFileLabel(filePath: string, updated: string): string {
  const versionMatch = filePath.match(/\/\d{4}-\d{2}-\d{2}\/([^/]+)\.csv$/);
  if (versionMatch) return versionMatch[1].replace(/-/g, ':');
  if (updated) {
    const date = new Date(updated);
    if (Number.isFinite(date.getTime())) {
      return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }
  return '従来形式';
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
