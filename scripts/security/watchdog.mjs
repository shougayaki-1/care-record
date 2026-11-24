import { evidenceUrl, sendDiscord } from './discord.mjs';
import { payload } from './monitor.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function checkWatchdog({ fetcher = fetch, environment, token, now = Date.now() }) {
  if (!['staging', 'production'].includes(environment) || !token) throw new Error('watchdog_config');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const read = async path => {
    const response = await fetcher(`https://api.github.com/repos/shougayaki-1/care-record/${path}`, {
      headers, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('watchdog_api_unavailable');
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('watchdog_invalid_payload');
    return JSON.parse(text);
  };
  const data = await read('actions/workflows/security-monitor.yml/runs?branch=main&per_page=10');
  if (!Array.isArray(data.workflow_runs)) throw new Error('watchdog_invalid_payload');
  for (const run of data.workflow_runs) {
    if (!Number.isSafeInteger(run.id) || !['schedule', 'workflow_dispatch'].includes(run.event)
      || run.head_branch !== 'main' || run.status !== 'completed' || !Number.isFinite(Date.parse(run.created_at))
      || now - Date.parse(run.created_at) > 20 * 60000 || Date.parse(run.created_at) > now) continue;
    const jobs = await read(`actions/runs/${run.id}/jobs?per_page=100`);
    if (!Array.isArray(jobs.jobs)) throw new Error('watchdog_invalid_payload');
    const job = jobs.jobs.find(j => j.name === `monitor (${environment})`);
    if (job?.conclusion === 'success' && job.steps?.some(s => s.name === 'Collect counts and deliver pending alerts' && s.conclusion === 'success')) return true;
  }
  return false;
}
export async function main() {
  try {
    const environment = process.env.APP_ENV;
    const link = evidenceUrl(process.env.EVIDENCE_URL);
    if (await checkWatchdog({ environment, token: process.env.GITHUB_TOKEN })) return;
    const now = new Date().toISOString();
    await sendDiscord(process.env.DISCORD_ALERT_WEBHOOK_URL,
      payload(environment, link, 'schedule_gap', 'Critical', 1, new Date(Date.now() - 20 * 60000).toISOString(), now));
    console.error('security_monitor_watchdog_stale');
  } catch {
    console.error('security_monitor_watchdog_failed');
    try {
      const now = new Date().toISOString();
      await sendDiscord(process.env.DISCORD_ALERT_WEBHOOK_URL,
        payload(process.env.APP_ENV, process.env.EVIDENCE_URL, 'source_unavailable', 'Critical', 0, now, now));
    } catch { console.error('security_monitor_watchdog_delivery_failed'); }
  }
  process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
