import 'server-only';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { Storage } from '@google-cloud/storage';
import { archiveConfig } from '@/utils/auditArchive/config';
import { ArchiveFailure, refSchema, type ObjectRef } from '@/utils/auditArchive/contracts';
import { createArchiveStore } from '@/utils/auditArchive/gcs';
import { runMetadataSchema } from './receipt';
import { createRemoteVerificationSource } from './remoteSource';
import { runVerificationWithNotification } from './notify';

type Env = Record<string, string | undefined>;

// Stable for retries of one Actions attempt, distinct across attempts and environments.
export function verificationRequestId(environment: string, runId: string, attempt: string): string {
  const bytes = createHash('sha256').update(JSON.stringify(['care-record-audit-verifier:1',environment,runId,attempt])).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function settingsReference(env: Env, environment: string): ObjectRef | undefined {
  const values = [env.AUDIT_RECOMPUTE_OBJECT, env.AUDIT_RECOMPUTE_GENERATION, env.AUDIT_RECOMPUTE_SHA256, env.AUDIT_RECOMPUTE_SIZE];
  if (values.every(value => value === undefined || value === '')) return undefined;
  const ref = refSchema.strict().safeParse({name:values[0], generation:values[1], digest:values[2], size:values[3]});
  if (!ref.success || !ref.data.name.startsWith(`control/${environment}/`)) throw new ArchiveFailure('not_configured');
  return ref.data;
}

export function verifierConfig(env: Env) {
  if (env.AUDIT_VERIFIER_ENABLED !== 'true' || env.GITHUB_ACTIONS !== 'true'
    || env.GITHUB_REPOSITORY !== 'shougayaki-1/care-record' || env.GITHUB_SERVER_URL !== 'https://github.com'
    || env.GCP_SERVICE_ACCOUNT_KEY_JSON || env.GCP_SERVICE_ACCOUNT_KEY_PATH || !env.GOOGLE_APPLICATION_CREDENTIALS
    || !env.CRON_SECRET || !env.AUDIT_VERIFIER_ORIGIN || !env.DISCORD_ALERT_WEBHOOK_URL
    || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new ArchiveFailure('not_configured');
  const archive = archiveConfig(env);
  if (archive.mode !== 'v2' || !['staging','production'].includes(archive.environment)
    || !archive.pinned.name.startsWith(`control/${archive.environment}/`)) throw new ArchiveFailure('not_configured');
  const metadata = runMetadataSchema.safeParse({environment:archive.environment,runId:env.GITHUB_RUN_ID,
    attempt:env.GITHUB_RUN_ATTEMPT,createdAt:env.AUDIT_VERIFICATION_STARTED_AT});
  if (!metadata.success || Date.parse(metadata.data.createdAt) > Date.now()) throw new ArchiveFailure('not_configured');
  return {archive,metadata:metadata.data,settingsPin:settingsReference(env,archive.environment),
    requestId:verificationRequestId(archive.environment,metadata.data.runId,metadata.data.attempt),
    credentialPath:env.GOOGLE_APPLICATION_CREDENTIALS,projectId:env.GCP_PROJECT_ID!,origin:env.AUDIT_VERIFIER_ORIGIN,
    secret:env.CRON_SECRET,webhook:env.DISCORD_ALERT_WEBHOOK_URL};
}

// WIF is required for the worker; the app's legacy static-key fallback is not.
// Shape checks do not prove the identity's actual IAM grants or bucket retention.
export async function requireWorkloadIdentity(path: string, env: Env) {
  try {
    if ((await stat(path)).size > 32 * 1024) throw new Error();
    const raw = await readFile(path, 'utf8');
    if (Buffer.byteLength(raw,'utf8') > 32 * 1024) throw new Error();
    const parsed = z.strictObject({type:z.literal('external_account'),audience:z.string().startsWith('//iam.googleapis.com/projects/'),
      subject_token_type:z.literal('urn:ietf:params:oauth:token-type:jwt'),token_url:z.literal('https://sts.googleapis.com/v1/token'),
      credential_source:z.strictObject({url:z.string(),headers:z.strictObject({Authorization:z.string()}),
        format:z.strictObject({type:z.literal('json'),subject_token_field_name:z.literal('value')})}),
      service_account_impersonation_url:z.string().optional()}).safeParse(JSON.parse(raw));
    if (!parsed.success || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error();
    const source = new URL(parsed.data.credential_source.url);
    const expected = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
    if (source.protocol !== 'https:' || expected.protocol !== 'https:' || source.username || source.password || source.hash
      || expected.username || expected.password || expected.hash || source.origin !== expected.origin || source.pathname !== expected.pathname
      || parsed.data.credential_source.headers.Authorization !== `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`) throw new Error();
    // The auth action appends only the requested audience to the runner URL.
    source.searchParams.delete('audience'); expected.searchParams.delete('audience');
    if (source.searchParams.toString() !== expected.searchParams.toString()) throw new Error();
    if (parsed.data.service_account_impersonation_url) {
      const url = new URL(parsed.data.service_account_impersonation_url);
      if (url.origin !== 'https://iamcredentials.googleapis.com' || url.username || url.password || url.search || url.hash
        || !/^\/v1\/projects\/-\/serviceAccounts\/[^/]+:generateAccessToken$/.test(url.pathname)) throw new Error();
    }
  } catch { throw new ArchiveFailure('not_configured'); }
}

// Deliberately never returns success until the unresolved history and all
// required verification gates have an approved success contract.
export async function runVerificationWorker(env: Env = process.env) {
  const config = verifierConfig(env);
  await requireWorkloadIdentity(config.credentialPath, env);
  const source = createRemoteVerificationSource(config.origin,config.archive.environment,config.secret,config.requestId);
  const storage = new Storage({projectId:config.projectId,keyFilename:config.credentialPath});
  const archive = createArchiveStore(config.archive.bucket, `verification/${config.archive.environment}/`,storage);
  const receipts = createArchiveStore(config.archive.bucket, `verification/${config.archive.environment}/`,storage);
  return runVerificationWithNotification(config.metadata,archive,receipts,config.archive.pinned,source,config.webhook,config.settingsPin);
}
