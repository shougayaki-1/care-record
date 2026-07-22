import { z } from 'zod';

const appEnvSchema = z.enum(['local', 'test', 'staging', 'production']);
const enabledSchema = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const optionalString = z.string().trim().optional();

const deploymentEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  APP_ENV: appEnvSchema.default('local'),
  AI_IMPORT_ENABLED: enabledSchema,
  EXTERNAL_INTEGRATIONS_ENABLED: enabledSchema.default(true),
  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  EXPECTED_SUPABASE_PROJECT_ID: optionalString,
  GCP_PROJECT_ID: optionalString,
  EXPECTED_GCP_PROJECT_ID: optionalString,
  GCS_EXPORT_BUCKET: optionalString,
  GCS_BACKUP_BUCKET: optionalString,
  GCS_REPLICA_BUCKET: optionalString,
  GCS_AUDIT_BUCKET: optionalString,
  GCP_WORKLOAD_IDENTITY_PROVIDER: optionalString,
  GCP_BACKUP_SERVICE_ACCOUNT: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,
  GOOGLE_TOKEN_ENCRYPTION_KEY: optionalString,
  GOOGLE_TOKEN_ENCRYPTION_KEYS: optionalString,
  GOOGLE_TOKEN_ACTIVE_KEY_ID: optionalString,
  AUDIT_IP_HASH_SALT: optionalString,
  CRON_SECRET: optionalString,
  DISCORD_ALERT_WEBHOOK_URL: optionalString,
  GCP_SERVICE_ACCOUNT_KEY_JSON: optionalString,
  GOOGLE_APPLICATION_CREDENTIALS: optionalString,
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && env.APP_ENV === 'local') {
    context.addIssue({ code: 'custom', path: ['APP_ENV'], message: 'APP_ENV must be explicitly set for a production server' });
  }
  if (env.APP_ENV !== 'staging' && env.APP_ENV !== 'production') return;

  if (env.APP_ENV === 'production' && !env.EXTERNAL_INTEGRATIONS_ENABLED) {
    context.addIssue({ code: 'custom', path: ['EXTERNAL_INTEGRATIONS_ENABLED'], message: 'Production requires external integrations to be enabled' });
  }

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'EXPECTED_SUPABASE_PROJECT_ID',
  ] as const;
  const externalRequired = [
    'GCP_PROJECT_ID', 'EXPECTED_GCP_PROJECT_ID',
    'GCS_EXPORT_BUCKET', 'GCS_BACKUP_BUCKET', 'GCS_REPLICA_BUCKET', 'GCS_AUDIT_BUCKET',
    'GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_BACKUP_SERVICE_ACCOUNT',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
    'GOOGLE_TOKEN_ACTIVE_KEY_ID', 'GOOGLE_TOKEN_ENCRYPTION_KEYS',
    'AUDIT_IP_HASH_SALT', 'CRON_SECRET', 'DISCORD_ALERT_WEBHOOK_URL',
  ] as const;
  const dummyPattern = /^(?:change[-_]?me|dummy|example|placeholder|your[-_]|test(?:ing)?$)/i;

  for (const key of [...required, ...(env.APP_ENV === 'production' || env.EXTERNAL_INTEGRATIONS_ENABLED ? externalRequired : [])]) {
    const value = env[key];
    if (!value || dummyPattern.test(value)) {
      context.addIssue({ code: 'custom', path: [key], message: `${key} must be configured with a non-placeholder value` });
    }
  }

  if (env.NEXT_PUBLIC_SUPABASE_URL && env.EXPECTED_SUPABASE_PROJECT_ID) {
    try {
      const projectId = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
      if (projectId !== env.EXPECTED_SUPABASE_PROJECT_ID) {
        context.addIssue({ code: 'custom', path: ['NEXT_PUBLIC_SUPABASE_URL'], message: 'Supabase project does not match EXPECTED_SUPABASE_PROJECT_ID' });
      }
    } catch {
      context.addIssue({ code: 'custom', path: ['NEXT_PUBLIC_SUPABASE_URL'], message: 'NEXT_PUBLIC_SUPABASE_URL must be a valid URL' });
    }
  }

  if (!env.EXTERNAL_INTEGRATIONS_ENABLED && env.AI_IMPORT_ENABLED) {
    context.addIssue({ code: 'custom', path: ['AI_IMPORT_ENABLED'], message: 'AI import requires external integrations to be enabled' });
  }

  if (env.EXTERNAL_INTEGRATIONS_ENABLED && env.GCP_PROJECT_ID && env.EXPECTED_GCP_PROJECT_ID && env.GCP_PROJECT_ID !== env.EXPECTED_GCP_PROJECT_ID) {
    context.addIssue({ code: 'custom', path: ['GCP_PROJECT_ID'], message: 'GCP project does not match EXPECTED_GCP_PROJECT_ID' });
  }

  const buckets = env.EXTERNAL_INTEGRATIONS_ENABLED
    ? [env.GCS_EXPORT_BUCKET, env.GCS_BACKUP_BUCKET, env.GCS_REPLICA_BUCKET, env.GCS_AUDIT_BUCKET].filter(Boolean) as string[]
    : [];
  if (new Set(buckets).size !== buckets.length) {
    context.addIssue({ code: 'custom', path: ['GCS_BACKUP_BUCKET'], message: 'GCS buckets must be distinct' });
  }
  for (const bucket of buckets) {
    const lower = bucket.toLowerCase();
    const crossesEnvironment = env.APP_ENV === 'staging'
      ? !lower.includes('staging')
      : /(?:^|[-_.])(?:staging|stage|test|dev)(?:$|[-_.])/.test(lower);
    if (crossesEnvironment) {
      context.addIssue({ code: 'custom', path: ['GCS_BACKUP_BUCKET'], message: `GCS bucket ${bucket} does not belong to ${env.APP_ENV}` });
    }
  }

  if (env.GOOGLE_REDIRECT_URI) {
    try { new URL(env.GOOGLE_REDIRECT_URI); } catch {
      context.addIssue({ code: 'custom', path: ['GOOGLE_REDIRECT_URI'], message: 'GOOGLE_REDIRECT_URI must be a valid URL' });
    }
  }

  if (env.EXTERNAL_INTEGRATIONS_ENABLED && env.GOOGLE_TOKEN_ENCRYPTION_KEYS && env.GOOGLE_TOKEN_ACTIVE_KEY_ID) {
    try {
      const keyring = JSON.parse(env.GOOGLE_TOKEN_ENCRYPTION_KEYS) as Record<string, string>;
      const activeKey = Buffer.from(keyring[env.GOOGLE_TOKEN_ACTIVE_KEY_ID] ?? '', 'base64');
      if (activeKey.length !== 32) throw new Error('invalid key');
    } catch {
      context.addIssue({ code: 'custom', path: ['GOOGLE_TOKEN_ENCRYPTION_KEYS'], message: 'Active Google token key must be a 32-byte base64 value in the keyring' });
    }
  }

  if (env.AI_IMPORT_ENABLED && !env.GCP_SERVICE_ACCOUNT_KEY_JSON && !env.GOOGLE_APPLICATION_CREDENTIALS) {
    context.addIssue({ code: 'custom', path: ['AI_IMPORT_ENABLED'], message: 'AI import requires Google Cloud credentials' });
  }
});

export type DeploymentEnv = z.infer<typeof deploymentEnvSchema>;

export function parseDeploymentEnv(input: NodeJS.ProcessEnv | Record<string, string | undefined>): DeploymentEnv {
  return deploymentEnvSchema.parse(input);
}
