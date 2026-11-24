import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readMonitorSnapshot, runMonitor, saveMonitorState } from './monitor.mjs';
import { evidenceUrl, sendDiscord } from './discord.mjs';

const project = 'xhvvfovvlqzlkirpjocv';
const requireCondition = condition => { if (!condition) throw new Error('staging_verification_failed'); };

export async function verifyStaging({ read, save, insert, expire, notify, link }) {
  evidenceUrl(link);
  const initial = await read();
  requireCondition(Object.values(initial.metrics).every(n => n === 0));
  requireCondition(!Object.values(initial.state.alerts ?? {}).some(a => a.active || a.pending));
  let failuresMessages = 0;
  let simulateFailure = false;
  const cycle = async () => runMonitor({ snapshot: await read(), save, environment: 'staging', link,
    notify: async p => {
      const target = p.embeds?.[0]?.footer?.text?.startsWith('failures_5m |');
      if (target && simulateFailure) { simulateFailure = false; throw new Error('synthetic_delivery_failure'); }
      await notify({ ...p, content: `[SYNTHETIC TEST] ${p.content}` });
      if (target) failuresMessages++;
    },
  });
  try {
    await insert(); await cycle(); requireCondition(failuresMessages === 1);
    await cycle(); requireCondition(failuresMessages === 1); // duplicate suppressed
    await expire(); await cycle(); requireCondition(failuresMessages === 1);
    await cycle(); requireCondition(failuresMessages === 2); // two observations resolve
    await insert(); simulateFailure = true;
    const failed = await cycle(); requireCondition(failed.deliveryFailures > 0);
    requireCondition((await read()).state.alerts.failures_5m.pending);
    await expire(); await cycle(); requireCondition(failuresMessages === 3); // durable outbox, expired observation
    await cycle(); await cycle(); requireCondition(failuresMessages === 4);
    await insert(); await cycle(); requireCondition(failuresMessages === 5); // reopen after clear
  } finally {
    await expire(); // Age only this run's synthetic attempts. Never DELETE or alter audit history.
  }
  await cycle(); await cycle(); requireCondition(failuresMessages === 6);
  return { ok: true, environment: 'staging', storage: 'postgres', notification: 'discord',
    failureMessages: failuresMessages, duplicateSuppression: true, recovery: true, outboxRetry: true };
}

export async function main() {
  try {
    requireCondition(process.env.APP_ENV === 'staging' && process.env.SECURITY_MONITOR_PROJECT_REF === project
      && process.env.PGUSER === `security_monitor_staging.${project}` && process.env.PGSSLMODE === 'verify-full'
      && process.env.PGHOST && process.env.PGPASSWORD && process.env.SUPABASE_ACCESS_TOKEN);
    const link = evidenceUrl(process.env.EVIDENCE_URL);
    const request = async (suffix, query) => {
      const response = await fetch(`https://api.supabase.com/v1/projects/${project}${suffix}`, {
        method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        ...(query ? { body: JSON.stringify({ query }) } : {}),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('staging_api_unavailable'); }
      if (query) { await response.body?.cancel(); return; }
      const text = await response.text(); requireCondition(text.length <= 65536); return JSON.parse(text);
    };
    const metadata = await request('');
    requireCondition(metadata.id === project && metadata.name === 'care-record-staging' && metadata.status === 'ACTIVE_HEALTHY');
    const ip = createHash('sha256').update(`security-monitor-synthetic:${randomUUID()}`).digest('hex');
    // Hex-only run identifier; neither raw emails nor raw network addresses exist.
    const expire = () => request('/database/query', `UPDATE public.login_attempts SET created_at=now()-interval '2 hours' WHERE ip_hash='${ip}';`);
    const insert = () => request('/database/query', `INSERT INTO public.login_attempts(ip_hash,email_hash,outcome,created_at)
      SELECT '${ip}',encode(extensions.digest('${ip}'||n::text,'sha256'),'hex'),'failure',now()-interval '1 minute' FROM generate_series(1,20) n;`);
    const result = await verifyStaging({ read: readMonitorSnapshot, save: saveMonitorState, insert, expire,
      notify: p => sendDiscord(process.env.DISCORD_ALERT_WEBHOOK_URL, p), link });
    console.log(JSON.stringify(result));
  } catch { console.error('staging_security_verification_failed'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
