import { NextRequest, NextResponse } from 'next/server';
import { getActiveOrganizationIds, exportReportsAsJson } from '@/utils/gcs/export';
import { isGcsBackupConfigured, uploadToGCS } from '@/utils/gcs/upload';
import { logError, serializeError } from '@/utils/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  return (
    !!process.env.CRON_SECRET &&
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isGcsBackupConfigured()) {
    return NextResponse.json({ ok: false, error: 'gcs_not_configured' }, { status: 500 });
  }

  const bucket = 'care-record-archive-7y';

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = lastMonth.getFullYear();
  const month = lastMonth.getMonth() + 1;
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  try {
    const orgIds = await getActiveOrganizationIds();
    let succeeded = 0;

    for (const orgId of orgIds) {
      const json = await exportReportsAsJson(orgId, year, month);
      await uploadToGCS(bucket, `monthly/${orgId}/${monthStr}.json`, json);
      succeeded++;
    }

    return NextResponse.json({ ok: true, orgs: succeeded, month: monthStr });
  } catch (err) {
    logError('[cron:backup-monthly]', { error: serializeError(err) });
    return NextResponse.json({ ok: false, error: 'backup_failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
