import { NextRequest, NextResponse } from 'next/server';
import { ArchiveFailure, requireCondition } from '@/utils/auditArchive/contracts';
import { archiveConfig } from '@/utils/auditArchive/config';
import { archiveHealth, archivePrefix, loadControl, runArchive } from '@/utils/auditArchive/publisher';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers });

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  try {
    const config = archiveConfig();
    const requestedEnvironment = request.headers.get('x-carerecord-environment');
    if (requestedEnvironment && requestedEnvironment !== config.environment) return json({ error: 'environment_mismatch' }, 403);
    // Lazy imports keep missing DB/GCS configuration inside the safe response path.
    const { createArchiveStore } = await import('@/utils/auditArchive/gcs');
    const store = createArchiveStore(config.bucket, `archive/${config.environment}/`);
    const control = await loadControl(store, config.pinned, config.environment);
    requireCondition((config.mode === 'v2') === control.baselineFinalized);
    if (request.nextUrl.searchParams.get('mode') === 'health') {
      const health = await archiveHealth(store, control);
      return json({ ok: !health.critical, ...health }, health.critical ? 503 : 200);
    }
    const { createArchiveSource } = await import('@/utils/auditArchive/source');
    const result = await runArchive(store, createArchiveSource(archivePrefix(control)), control);
    return json({ ok: result.status === 'complete', ...result }, result.status === 'complete' ? 200 : 202);
  } catch (error) {
    const category = error instanceof ArchiveFailure ? error.category : 'unavailable';
    // Never log raw exceptions, IDs, object names, credentials or canonical data.
    return json({ ok: false, status: category }, category === 'incomplete' ? 202 : 503);
  }
}
