import { describe, expect, it } from 'vitest';
import { parseDeploymentEnv } from './schema';

const key = Buffer.alloc(32, 7).toString('base64');
const productionEnv = {
  APP_ENV: 'production',
  AI_IMPORT_ENABLED: 'false',
  NEXT_PUBLIC_SUPABASE_URL: 'https://prodref.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-real-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-real-value',
  EXPECTED_SUPABASE_PROJECT_ID: 'prodref',
  GCP_PROJECT_ID: 'care-record-prod',
  EXPECTED_GCP_PROJECT_ID: 'care-record-prod',
  GCS_EXPORT_BUCKET: 'care-record-export',
  GCS_BACKUP_BUCKET: 'care-record-backup',
  GCS_REPLICA_BUCKET: 'care-record-replica',
  GCS_AUDIT_BUCKET: 'care-record-audit',
  GCP_WORKLOAD_IDENTITY_PROVIDER: 'projects/123/locations/global/workloadIdentityPools/github/providers/actions',
  GCP_BACKUP_SERVICE_ACCOUNT: 'backup@care-record-prod.iam.gserviceaccount.com',
  GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-secret-value',
  GOOGLE_REDIRECT_URI: 'https://app.example.jp/api/google/callback',
  GOOGLE_TOKEN_ACTIVE_KEY_ID: '2026-07',
  GOOGLE_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ '2026-07': key }),
  AUDIT_IP_HASH_SALT: 'random-audit-salt',
  CRON_SECRET: 'random-cron-secret',
  DISCORD_ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/token',
};

describe('parseDeploymentEnv', () => {
  it('keeps local development permissive and disables AI by default', () => {
    expect(parseDeploymentEnv({})).toMatchObject({ APP_ENV: 'local', AI_IMPORT_ENABLED: false });
  });

  it('rejects an implicit local APP_ENV on a production server', () => {
    expect(() => parseDeploymentEnv({ NODE_ENV: 'production' })).toThrow(/APP_ENV/);
  });

  it('accepts a complete production environment', () => {
    expect(parseDeploymentEnv(productionEnv).APP_ENV).toBe('production');
  });

  it('rejects a Supabase project mismatch', () => {
    expect(() => parseDeploymentEnv({ ...productionEnv, EXPECTED_SUPABASE_PROJECT_ID: 'otherref' })).toThrow(/Supabase project/);
  });

  it('rejects a GCP project mismatch and staging bucket crossover', () => {
    expect(() => parseDeploymentEnv({ ...productionEnv, GCP_PROJECT_ID: 'other-project' })).toThrow(/GCP project/);
    expect(() => parseDeploymentEnv({ ...productionEnv, GCS_BACKUP_BUCKET: 'care-record-staging-backup' })).toThrow(/does not belong/);
  });

  it('requires credentials when AI import is enabled', () => {
    expect(() => parseDeploymentEnv({ ...productionEnv, AI_IMPORT_ENABLED: 'true' })).toThrow(/Google Cloud credentials/);
  });

  it('accepts a staging deployment with external integrations explicitly disabled', () => {
    expect(parseDeploymentEnv({
      APP_ENV: 'staging',
      AI_IMPORT_ENABLED: 'false',
      EXTERNAL_INTEGRATIONS_ENABLED: 'false',
      NEXT_PUBLIC_SUPABASE_URL: 'https://stagingref.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-staging-value',
      SUPABASE_SERVICE_ROLE_KEY: 'service-staging-value',
      EXPECTED_SUPABASE_PROJECT_ID: 'stagingref',
    })).toMatchObject({ APP_ENV: 'staging', EXTERNAL_INTEGRATIONS_ENABLED: false });
  });

  it('does not allow AI import when external integrations are disabled', () => {
    expect(() => parseDeploymentEnv({
      APP_ENV: 'staging',
      AI_IMPORT_ENABLED: 'true',
      EXTERNAL_INTEGRATIONS_ENABLED: 'false',
      NEXT_PUBLIC_SUPABASE_URL: 'https://stagingref.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-staging-value',
      SUPABASE_SERVICE_ROLE_KEY: 'service-staging-value',
      EXPECTED_SUPABASE_PROJECT_ID: 'stagingref',
    })).toThrow(/external integrations/);
  });
});
