import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMonitor, validateSnapshot, payload } from './monitor.mjs';
import { sendDiscord, evidenceUrl } from './discord.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const link = 'https://github.com/shougayaki-1/care-record/actions/runs/123';
const webhook = 'https://discord.com/api/webhooks/123/synthetic-token';
function fixture() {
  return { observed_at: '2026-10-26T01:00:00Z', day_start: '2026-10-24T15:00:00Z', day_end: '2026-10-25T15:00:00Z',
    version: 0, state: {}, metrics: { failures_5m: 0, failures_15m: 0, spray_sources_15m: 0, distributed_targets_15m: 0,
      success_after_failures_15m: 0, missing_hashes_15m: 0, attempts_15m: 0, audit_logins_15m: 0 },
    daily: { failures: 0, successes: 0, missing_hashes: 0, important_events: 0 } };
}
async function run(s, fail = () => false, options = {}) {
  const sent = [];
  const result = await runMonitor({ snapshot: s, environment: 'staging', link,
    ...options,
    save: async (version, state) => { assert.equal(version, s.version); s.version++; s.state = structuredClone(state); return s.version; },
    notify: async p => { if (fail(p)) throw new Error('credential-do-not-log'); sent.push(p); },
  });
  return { sent, result };
}
const category = (messages, key) => messages.filter(p => p.embeds?.[0]?.footer?.text?.startsWith(`${key} |`));
function advance(s, minutes = 5) { s.observed_at = new Date(Date.parse(s.observed_at) + minutes * 60000).toISOString(); }

test('synthetic spike -> one alert -> suppression -> two clear observations -> alert again', async () => {
  const s = fixture(); s.metrics.failures_5m = 20;
  assert.equal(category((await run(s)).sent, 'failures_5m').length, 1);
  advance(s); assert.equal(category((await run(s)).sent, 'failures_5m').length, 0);
  s.metrics.failures_5m = 0;
  advance(s); assert.equal(category((await run(s)).sent, 'failures_5m').length, 0);
  advance(s); assert.match(category((await run(s)).sent, 'failures_5m')[0].content, /解消/);
  s.metrics.failures_5m = 20; advance(s);
  assert.match(category((await run(s)).sent, 'failures_5m')[0].content, /発生/);
});
test('persistent anomalies remind hourly; no recovery across hysteresis band', async () => {
  const s = fixture(); s.metrics.failures_5m = 20; await run(s);
  advance(s, 60); assert.match(category((await run(s)).sent, 'failures_5m')[0].content, /継続中/);
  s.metrics.failures_5m = 8;
  advance(s); await run(s); advance(s);
  assert.equal(category((await run(s)).sent, 'failures_5m').length, 0);
});
test('failed delivery retains outbox and retries after the observation window expires', async () => {
  const s = fixture(); s.metrics.failures_5m = 20;
  const first = await run(s, p => p.embeds?.[0]?.footer?.text?.startsWith('failures_5m |'));
  assert.ok(first.result.deliveryFailures >= 1);
  assert.ok(s.state.alerts.failures_5m.pending);
  s.metrics.failures_5m = 0; advance(s, 30);
  assert.equal(category((await run(s)).sent, 'failures_5m').length, 1);
  assert.equal(s.state.alerts.failures_5m.pending, undefined);
});
test('Discord outage does not starve detection of later categories or overwrite their acks', async () => {
  const s = fixture(); s.metrics.failures_5m = 20; s.metrics.missing_hashes_15m = 1;
  let calls = 0;
  await run(s, () => { calls++; return true; });
  assert.equal(calls, 1);
  assert.ok(s.state.alerts.failures_5m.pending);
  assert.ok(s.state.alerts.missing_hashes_15m.pending);
  advance(s); await run(s);
  assert.equal(s.state.alerts.failures_5m.active, true);
  assert.equal(s.state.alerts.missing_hashes_15m.active, true);
});
test('daily summary retries and deduplicates, schedule gap and source gaps are explicit', async () => {
  const s = fixture(); await run(s, p => p.embeds?.[0]?.footer?.text?.startsWith('daily_summary |'));
  advance(s); assert.equal(category((await run(s)).sent, 'daily_summary').length, 1);
  advance(s); assert.equal(category((await run(s)).sent, 'daily_summary').length, 0);
  advance(s, 25); assert.equal(category((await run(s)).sent, 'schedule_gap').length, 1);
});
test('invalid data never becomes zero; state/metrics/details/identifiers are not serialized', async () => {
  for (const value of [null, -1, 'secret@example.test', NaN, Infinity]) {
    const bad = fixture(); bad.metrics.failures_5m = value;
    assert.throws(() => validateSnapshot(bad));
  }
  const s = fixture();
  s.metrics.details = 'secret@example.test Cookie JWT 192.0.2.1';
  s.state.private = s.metrics.details; s.daily.details = s.metrics.details;
  const all = JSON.stringify((await run(s)).sent);
  for (const value of ['secret@', 'Cookie', 'JWT', '192.0.2.1', 'synthetic-token']) assert.ok(!all.includes(value));
  assert.ok(all.includes('攻撃や被害があったと確定した通知ではありません'));
  assert.throws(() => evidenceUrl(`${link}?token=secret`));
  assert.throws(() => payload('production', link, 'secret@example.test', 'Info', 0, s.observed_at, s.observed_at));
});
test('Firewall counts use actual source window, alerts have explicit provider attribution, missing data cannot resolve', async () => {
  const s = fixture();
  const firewall = { status: 'available', traffic: { start: '2026-10-26T00:44:00Z', end: '2026-10-26T01:00:00Z', counts: { deny: 20, challenge: 3, rate_limit: 1 } },
    alerts: { active: 1, resolved: 0 }, ip: 'PRIVATE-IP' };
  const first = (await run(s, () => false, { firewall })).sent;
  assert.equal(category(first, 'firewall_denies').length, 1);
  assert.ok(JSON.stringify(category(first, 'firewall_denies')).includes('9:44'));
  assert.ok(JSON.stringify(category(first, 'firewall_active_alerts')).includes('Vercelがアクセスの異常を報告'));
  assert.ok(!JSON.stringify(first).includes('PRIVATE-IP'));
  firewall.traffic.counts.deny = 0; firewall.alerts.active = 0;
  advance(s); await run(s, () => false, { firewall }); // first clear observation
  advance(s);
  const missing = { status: 'incomplete', traffic: null, alerts: null };
  await run(s, () => false, { firewall: missing });
  advance(s);
  const second = (await run(s, () => false, { firewall: missing })).sent;
  assert.equal(category(second, 'firewall_denies').length, 0);
  assert.equal(s.state.alerts.firewall_denies.active, true);
  advance(s); await run(s, () => false, { firewall });
  assert.equal(s.state.alerts.firewall_denies.active, true); // gap broke the earlier clear streak
  advance(s);
  assert.match(category((await run(s, () => false, { firewall })).sent, 'firewall_denies')[0].content, /解消/);
});
test('Discord retries 429 Retry-After and 5xx, suppresses mentions, never follows redirects', async () => {
  const statuses = [429, 503, 200], delays = [];
  await sendDiscord(webhook, { content: 'synthetic', allowed_mentions: { parse: ['everyone'] } }, {
    fetcher: async (url, init) => {
      assert.equal(url.search, '?wait=true'); assert.equal(init.redirect, 'error');
      assert.deepEqual(JSON.parse(init.body).allowed_mentions, { parse: [] });
      return new Response(null, { status: statuses.shift(), headers: { 'retry-after': '3' } });
    }, sleep: async ms => delays.push(ms),
  });
  assert.deepEqual(delays, [3000, 3000]);
});
test('Discord permanent errors, long rate limit, network failures and invalid endpoints are bounded', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(sendDiscord(webhook, {}, { fetcher: async () => {
      calls++; return new Response(null, { status, headers: { 'retry-after': status === 429 ? '120' : '0' } });
    }, sleep: async () => {} }));
    assert.equal(calls, status === 500 ? 4 : 1);
  }
  await assert.rejects(sendDiscord('https://evil.test/api/webhooks/123/token', {}));
  let calls = 0;
  await assert.rejects(sendDiscord(webhook, {}, { fetcher: async () => { calls++; throw new Error('private'); }, sleep: async () => {} }));
  assert.equal(calls, 4);
});
test('existing backup shell uses shared transport and strips query/detail secrets', t => {
  const dir = mkdtempSync(join(tmpdir(), 'care-discord-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'fetch.mjs');
  writeFileSync(preload, `globalThis.fetch=async(url,init)=>{console.log(init.body);return new Response(null,{status:204});};`);
  const result = spawnSync('bash', ['scripts/backup/notify-discord.sh', 'High', 'security_probe', `${link}?token=PRIVATE`, 'email@example.test'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, APP_ENV: 'staging', DISCORD_ALERT_WEBHOOK_URL: webhook, NODE_OPTIONS: `--import=${preload}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.content, '[CareRecord] High / security_probe');
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.ok(!result.stdout.includes('PRIVATE'));
  assert.ok(!result.stdout.includes('email@'));
  assert.ok(!result.stdout.includes('synthetic-token'));
});

test('Staging Auth count alerts, missing source warns and cannot resolve an active alert', async () => {
  const s = fixture();
  const auth = { status: 'available', invalid_credentials: 50, start: '2026-10-26T00:45:00Z', end: '2026-10-26T01:00:00Z' };
  const first = (await run(s, () => false, { auth })).sent;
  assert.equal(category(first, 'auth_invalid_credentials').length, 1);
  advance(s); const missing = (await run(s, () => false, { auth: { status: 'unavailable' } })).sent;
  assert.equal(category(missing, 'auth_source_gap').length, 1);
  assert.equal(s.state.alerts.auth_invalid_credentials.active, true);
  advance(s); await run(s, () => false, { auth: { status: 'unavailable' } });
  assert.equal(s.state.alerts.auth_invalid_credentials.active, true);
});

test('通知は状況と次の行動を日本語で示し、個別の記録は含めない', () => {
  const s = fixture();
  for (const key of [...Object.keys((s.metrics)), 'audit_gap_15m', 'schedule_gap', 'source_unavailable', 'firewall_denies', 'firewall_active_alerts', 'firewall_source_gap', 'auth_invalid_credentials', 'auth_source_gap', 'daily_summary', 'notification_probe']) {
    if (['attempts_15m', 'audit_logins_15m'].includes(key)) continue;
    const message = payload('production', link, key, 'Warning', 3, s.observed_at, s.observed_at);
    assert.match(message.content, /本番/);
    assert.match(message.embeds[0].description, /何をすればいい？/);
    assert.doesNotMatch(message.embeds[0].description, /\\\\n/);
    assert.match(message.embeds[0].description, /日本時間/);
  }
  const recovered = payload('production', link, 'failures_5m', 'Info', 0, s.observed_at, s.observed_at, 'resolved');
  assert.match(recovered.content, /解消/);
  assert.match(recovered.embeds[0].description, /落ち着きました/);
});

test('認証失敗とアプリ側の記録がともにゼロの場合は原因未確定の警告を出す', async () => {
  const s = fixture();
  const auth = { status: 'available', invalid_credentials: 3, start: '2026-10-26T00:45:00Z', end: s.observed_at };
  const first = await run(s, () => false, { auth });
  const warning = category(first.sent, 'ingestion_evidence_gap');
  assert.equal(warning.length, 1);
  assert.match(warning[0].embeds[0].description, /直接アクセス/);
  advance(s); await run(s, () => false, { auth: { status: 'unavailable' } });
  assert.equal(s.state.alerts.ingestion_evidence_gap.active, true);
  s.metrics.attempts_15m = 1; advance(s);
  auth.start = new Date(Date.parse(s.observed_at) - 15 * 60000).toISOString(); auth.end = s.observed_at;
  await run(s, () => false, { auth });
  assert.equal(s.state.alerts.ingestion_evidence_gap.active, true);
  advance(s); auth.start = new Date(Date.parse(s.observed_at) - 15 * 60000).toISOString(); auth.end = s.observed_at;
  assert.match(category((await run(s, () => false, { auth })).sent, 'ingestion_evidence_gap')[0].content, /解消/);
});

test('DDoS-only monitoring alerts on active mitigations without treating other sources as available', async () => {
  const s = fixture();
  const firewall = { status: 'incomplete', mode: 'ddos-only', traffic: null, alerts: null, ddos: { status: 'available', active: 1 } };
  const sent = (await run(s, () => false, { firewall })).sent;
  assert.equal(category(sent, 'firewall_ddos_active').length, 1);
  assert.equal(category(sent, 'firewall_source_gap').length, 1);
  assert.equal(category(sent, 'firewall_ddos_source_gap').length, 0);
  advance(s);
  const missing = await run(s, () => false, { firewall: { ...firewall, ddos: { status: 'unavailable', active: null } } });
  assert.equal(category(missing.sent, 'firewall_ddos_source_gap').length, 1);
  assert.equal(s.state.alerts.firewall_ddos_active.active, true);
});
