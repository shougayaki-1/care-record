import 'server-only';
import { Storage } from '@google-cloud/storage';
import { archiveConfig } from '@/utils/auditArchive/config';
import { ArchiveFailure, type Store } from '@/utils/auditArchive/contracts';
import { createArchiveStore } from '@/utils/auditArchive/gcs';
import { notifyVerificationFailure } from './notify';
import { checkScheduledVerification } from './scheduleWatch';

type Env = Record<string,string | undefined>;

// Evidence URL is a fixed Actions run link, never an arbitrary notification URL.
function notificationConfig(env: Env) {
  try {
    const link=new URL(env.AUDIT_WATCHDOG_EVIDENCE_URL ?? '');
    const match=link.pathname.match(/^\/shougayaki-1\/care-record\/actions\/runs\/([1-9][0-9]{0,19})$/);
    const webhook=new URL(env.DISCORD_ALERT_WEBHOOK_URL ?? '');
    if (link.origin!=='https://github.com' || link.username || link.password || link.search || link.hash || !match
      || !['staging','production'].includes(env.APP_ENV ?? '') || webhook.protocol!=='https:' || webhook.hostname!=='discord.com'
      || webhook.port || webhook.username || webhook.password || webhook.search || webhook.hash
      || !/^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+$/.test(webhook.pathname)) throw new Error();
    return {runId:match[1],webhook:webhook.href};
  } catch { throw new ArchiveFailure('not_configured'); }
}
export async function notifyScheduleWatch(env: Env, category: 'incomplete' | 'unavailable') {
  try {
    const {runId,webhook}=notificationConfig(env);
    await notifyVerificationFailure({environment:env.APP_ENV,runId,attempt:'1',createdAt:new Date().toISOString()},category,webhook);
  } catch { throw new ArchiveFailure('unavailable'); }
}

// Runs on an independently provisioned host with read-only GCS and GitHub access.
// No secret, schedule, IAM or infrastructure is created by this function.
export async function runScheduleWatch(env: Env = process.env) {
  if (env.AUDIT_SCHEDULE_WATCH_ENABLED!=='true' || !env.AUDIT_WATCHDOG_GITHUB_TOKEN || !env.AUDIT_VERIFICATION_MONITORING_STARTED_AT
    || env.GCP_SERVICE_ACCOUNT_KEY_JSON || env.GCP_SERVICE_ACCOUNT_KEY_PATH || env.GOOGLE_APPLICATION_CREDENTIALS) throw new ArchiveFailure('not_configured');
  notificationConfig(env);
  const config=archiveConfig(env);
  if (config.mode!=='v2' || (config.environment!=='staging' && config.environment!=='production')) throw new ArchiveFailure('not_configured');
  const storage=new Storage({projectId:env.GCP_PROJECT_ID});
  const actual=createArchiveStore(config.bucket,'__audit_watch_no_writes__/',storage);
  const readOnly:Store={read:actual.read,async list(){throw new ArchiveFailure('mismatch');},async create(){throw new ArchiveFailure('mismatch');}};
  const result=await checkScheduledVerification(readOnly,config.pinned,config.environment,env.AUDIT_WATCHDOG_GITHUB_TOKEN,env.AUDIT_VERIFICATION_MONITORING_STARTED_AT);
  if (result.schedule==='missing' || result.successEvidenceOverdue) await notifyScheduleWatch(env,'incomplete');
  return result;
}
