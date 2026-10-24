import { z } from 'zod';
import { ArchiveFailure, refSchema } from './contracts';

export function archiveConfig(env: Record<string, string | undefined> = process.env) {
  const environment = z.enum(['local', 'staging', 'production']).safeParse(env.APP_ENV);
  const mode = z.enum(['inventory', 'v2']).safeParse(env.AUDIT_ARCHIVE_MODE);
  if (!environment.success || !mode.success || env.EXTERNAL_INTEGRATIONS_ENABLED === 'false') throw new ArchiveFailure('not_configured');
  const bucket = env.GCS_AUDIT_BUCKET;
  if (!bucket || !bucket.includes(`-${environment.data}-`) || bucket === env.GCS_AUDIT_LEGACY_BUCKET
    || bucket === 'care-record-archive-7y' || !env.GCP_PROJECT_ID || env.GCP_PROJECT_ID !== env.EXPECTED_GCP_PROJECT_ID) {
    throw new ArchiveFailure('not_configured');
  }
  const pinned = refSchema.parse({
    name: env.AUDIT_CONTROL_OBJECT, generation: env.AUDIT_CONTROL_GENERATION,
    digest: env.AUDIT_CONTROL_SHA256, size: env.AUDIT_CONTROL_SIZE,
  });
  return { environment: environment.data, mode: mode.data, bucket, pinned };
}
