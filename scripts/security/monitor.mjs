import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { evidenceUrl, sendDiscord } from './discord.mjs';

// Count thresholds are deliberately fixed and reviewed in code. Hysteresis clears
// only at <= clear for two consecutive successful observations.
export const rules = {
  failures_5m: { high: 20, clear: 5, severity: 'High' },
  failures_15m: { high: 50, clear: 10, severity: 'High' },
  spray_sources_15m: { high: 1, clear: 0, severity: 'High' },
  distributed_targets_15m: { high: 1, clear: 0, severity: 'High' },
  success_after_failures_15m: { high: 1, clear: 0, severity: 'High' },
  missing_hashes_15m: { high: 1, clear: 0, severity: 'Warning' },
};
const count = n => Number.isSafeInteger(n) && n >= 0;
const timestamp = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const categories = [...Object.keys(rules), 'audit_gap_15m', 'schedule_gap', 'daily_summary', 'notification_probe', 'source_unavailable'];

export function validateSnapshot(s) {
  if (!s || !timestamp(s.observed_at) || !timestamp(s.day_start) || !timestamp(s.day_end)
    || !count(s.version) || !s.state || typeof s.state !== 'object' || Array.isArray(s.state)
    || Date.parse(s.day_end) - Date.parse(s.day_start) !== 86400000
    || Date.parse(s.observed_at) < Date.parse(s.day_end)
    || Date.parse(s.observed_at) - Date.parse(s.day_end) >= 86400000
    || ![...Object.keys(rules), 'attempts_15m', 'audit_logins_15m'].every(k => count(s.metrics?.[k]))
    || !['failures', 'successes', 'missing_hashes', 'important_events'].every(k => count(s.daily?.[k]))) throw new Error('invalid_snapshot');
  return s;
}

export function payload(environment, link, category, severity, value, start, end, status = 'open', daily) {
  if (!['production', 'staging'].includes(environment) || !categories.includes(category)
    || !['Critical', 'High', 'Warning', 'Info'].includes(severity) || !count(value)
    || !timestamp(start) || !timestamp(end) || !['open', 'reminder', 'resolved', 'summary', 'test'].includes(status)
    || (daily && !['failures', 'successes', 'missing_hashes', 'important_events'].every(k => count(daily[k])))) throw new Error('invalid_alert');
  // Rebuild from allowlisted scalars: never serialize a DB/API record, state or error.
  const utc = new Date(end).toISOString();
  const jst = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(end));
  const summary = daily ? ` failures=${daily.failures} successes=${daily.successes} missing_hashes=${daily.missing_hashes} important_events=${daily.important_events}` : '';
  return {
    content: `[CareRecord] ${severity} | ${environment} | ${category} | ${status}`,
    embeds: [{ description: `${category === 'daily_summary' ? '集計（重要監査は正常操作を含む）' : '疑わしい傾向／監視状態（攻撃確定ではありません）'}\ncount=${category === 'source_unavailable' ? 'unavailable' : value}${summary}\nwindow=${new Date(start).toISOString()} / ${utc}\nJST=${jst} / UTC=${utc}\nFirewall block/challenge=unavailable; Auth direct=unverified; ingestion=unverified\n対応: Actions実行結果と認証・監査ダッシュボードを確認。Highは速やかに、Warningは当日中。\n${evidenceUrl(link)}` }],
  };
}

// Injected IO allows complete synthetic runs with no real Discord/DB access.
export async function runMonitor({ snapshot, save, notify, environment, link, probe = false }) {
  const s = validateSnapshot(snapshot);
  evidenceUrl(link);
  const now = Date.parse(s.observed_at);
  const previous = s.state;
  // Only bounded known state is copied forward. Ignore arbitrary persisted keys.
  const state = { last_observed: s.observed_at, daily_end: timestamp(previous.daily_end) ? previous.daily_end : null, alerts: {} };
  let version = s.version;
  let deliveryFailures = 0;
  let deliveryUnavailable = false;
  const persist = async () => { version = await save(version, state); };
  const deliver = async (...args) => {
    if (deliveryUnavailable) { deliveryFailures++; return false; }
    try { await notify(payload(environment, link, ...args)); return true; }
    catch { deliveryFailures++; deliveryUnavailable = true; return false; }
  };
  const metrics = { ...s.metrics, audit_gap_15m: Math.abs(s.metrics.attempts_15m - s.metrics.audit_logins_15m),
    schedule_gap: !timestamp(previous.last_observed) || now - Date.parse(previous.last_observed) > 20 * 60000 ? 1 : 0 };
  const allRules = { ...rules, audit_gap_15m: { high: 3, clear: 0, severity: 'Warning' }, schedule_gap: { high: 1, clear: 0, severity: 'Warning' } };
  const pendingValid = p => p && count(p.value) && timestamp(p.start) && timestamp(p.end)
    && ['open', 'reminder', 'resolved'].includes(p.status);
  // Populate every key before the first write so a mid-run crash preserves later acks.
  for (const key of Object.keys(allRules)) {
    const old = previous.alerts?.[key];
    state.alerts[key] = { active: old?.active === true, sent: timestamp(old?.sent) ? old.sent : null,
      clears: count(old?.clears) ? Math.min(old.clears, 2) : 0,
      ...(pendingValid(old?.pending) ? { pending: { value: old.pending.value, start: old.pending.start, end: old.pending.end, status: old.pending.status } } : {}) };
  }
  for (const [key, rule] of Object.entries(allRules)) {
    const old = state.alerts[key];
    if (old.pending) {
      const p = old.pending;
      if (await deliver(key, p.status === 'resolved' ? 'Info' : rule.severity, p.value, p.start, p.end, p.status)) {
        state.alerts[key] = { active: p.status !== 'resolved', sent: s.observed_at, clears: 0 };
      }
      await persist();
      continue;
    }
    const active = old?.active === true;
    const sent = timestamp(old?.sent) ? Date.parse(old.sent) : 0;
    const clears = count(old?.clears) ? Math.min(old.clears, 2) : 0;
    const value = metrics[key];
    let next = { active, sent: sent ? new Date(sent).toISOString() : null, clears: 0 };
    let status;
    if (value >= rule.high && (!active || now - sent >= 60 * 60000)) status = active ? 'reminder' : 'open';
    else if (active && value <= rule.clear) {
      next.clears = clears + 1;
      if (next.clears >= 2) status = 'resolved';
    }
    if (status) {
      const start = new Date(now - (key.endsWith('_5m') ? 5 : key === 'schedule_gap' ? 20 : 15) * 60000).toISOString();
      // Persist an outbox entry BEFORE attempting delivery; failures survive even
      // if the triggering time window has expired by the next successful run.
      state.alerts[key] = { ...next, pending: { value, start, end: s.observed_at, status } };
      await persist();
      if (await deliver(key, status === 'resolved' ? 'Info' : rule.severity, value, start, s.observed_at, status)) {
        next = { active: status !== 'resolved', sent: s.observed_at, clears: 0 };
      } else next = state.alerts[key];
    }
    state.alerts[key] = next;
    await persist(); // A later notification failure cannot discard an earlier acknowledgement.
  }
  if (state.daily_end !== s.day_end) {
    if (await deliver('daily_summary', 'Info', s.daily.failures, s.day_start, s.day_end, 'summary', s.daily)) state.daily_end = s.day_end;
  }
  if (probe) await deliver('notification_probe', 'Info', 0, s.observed_at, s.observed_at, 'test');
  await persist();
  return { deliveryFailures, source: 'available', firewall: 'unavailable', authDirect: 'unverified', ingestion: 'unverified' };
}

function sql(query) {
  // libpq environment only: credentials never appear in argv/output. No shell.
  return execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: `SET statement_timeout='20s'; SET timezone='UTC'; ${query}`, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 65536,
  }).trim();
}

export async function main() {
  const environment = process.env.APP_ENV;
  const link = process.env.EVIDENCE_URL;
  const notify = p => sendDiscord(process.env.DISCORD_ALERT_WEBHOOK_URL, p);
  try {
    const project = process.env.SECURITY_MONITOR_PROJECT_REF;
    if (!['production', 'staging'].includes(environment) || !/^[a-z]{20}$/.test(project || '')
      || !process.env.PGHOST || process.env.PGUSER !== `security_monitor_${environment}.${project}` || !process.env.PGPASSWORD
      || process.env.PGSSLMODE !== 'verify-full') throw new Error('invalid_config');
    evidenceUrl(link);
    const snapshot = JSON.parse(sql('SELECT private.security_monitor_snapshot();'));
    const result = await runMonitor({ snapshot, environment, link, notify,
      probe: process.env.SECURITY_MONITOR_PROBE === 'true',
      save: async (version, state) => {
        // Hex encodes our projected state to avoid SQL quoting/interpolation hazards.
        const hex = Buffer.from(JSON.stringify(state)).toString('hex');
        const next = Number(sql(`SELECT private.security_monitor_save(${version}, convert_from(decode('${hex}','hex'),'UTF8')::jsonb);`));
        if (!count(next)) throw new Error('invalid_version');
        return next;
      },
    });
    console.log(JSON.stringify(result));
    if (result.deliveryFailures) process.exitCode = 1;
  } catch {
    console.error('security_monitor_failed_source_or_state_unavailable');
    try {
      const now = new Date().toISOString();
      await notify(payload(environment, link, 'source_unavailable', 'Critical', 0, now, now));
    } catch { console.error('security_monitor_delivery_failed'); }
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
