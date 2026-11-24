import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFirewall, projectTraffic, projectAlerts } from './firewall.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const now = Date.parse('2026-10-26T14:00:00Z');
const traffic = { period: { start: '2026-10-26T13:45:00Z', end: '2026-10-26T14:00:00Z' },
  stats: { deny: 20 }, topLists: [{ dimension: 'ip', value: '192.0.2.1' }], token: 'PRIVATE' };
test('upstream payload projects only allowlisted counts and actual windows', () => {
  const result = projectTraffic(traffic, now);
  assert.equal(result.counts.deny, 20); assert.equal(result.counts.challenge, 0);
  assert.equal(result.start, '2026-10-26T13:45:00.000Z');
  assert.ok(!JSON.stringify(result).includes('192.0.2.1'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.deepEqual(projectAlerts({ active: [{ ip: 'PRIVATE' }], resolved: [] }), { active: 1, resolved: 0 });
});
test('missing, stale, oversized or malformed statistics cannot become zero', () => {
  for (const bad of [{}, { ...traffic, stats: null }, { ...traffic, stats: { secret: 5 } },
    { ...traffic, stats: { deny: -1 } }, { ...traffic, stats: { deny: '20' } },
    { ...traffic, period: { ...traffic.period, end: '2026-10-26T10:00:00Z' } }]) assert.throws(() => projectTraffic(bad, now));
  assert.throws(() => projectAlerts({}));
});
test('collector uses explicit team/project and only action dimension; unavailable sources remain null', async () => {
  const seen = [];
  const result = await collectFirewall({ environment: 'staging', enabled: true, now, runner: async args => {
    seen.push(args);
    if (args.includes('traffic')) return traffic;
    throw new Error('private-permission-details');
  } });
  assert.equal(result.status, 'incomplete'); assert.equal(result.alerts, null); assert.equal(result.traffic.counts.deny, 20);
  assert.ok(seen.every(args => args.includes('team_ysW0wFQFYn4lGeDbqSnJtdDc') && args.includes('prj_B1IUy7IKAuHXDWEelGooUkOR7Hgd')));
  assert.deepEqual(seen[0].slice(-2), ['--dimension', 'action']);
  assert.ok(!JSON.stringify(result).includes('private-permission-details'));
});
test('disabled collection does not use credentials; environments and windows are bounded', async () => {
  assert.deepEqual(await collectFirewall({ environment: 'production', enabled: false, runner: async () => { throw Error(); } }), { status: 'disabled' });
  await assert.rejects(collectFirewall({ environment: 'other', enabled: true }));
  await assert.rejects(collectFirewall({ environment: 'production', enabled: true, since: '7d' }));
});
test('short-term collection rejects a successful response with an unexpectedly long window', async () => {
  const result = await collectFirewall({ environment: 'production', enabled: true, now, runner: async args => args.includes('traffic')
    ? { ...traffic, period: { start: '2026-10-25T14:00:00Z', end: traffic.period.end } } : { active: [], resolved: [] } });
  assert.equal(result.status, 'incomplete'); assert.equal(result.traffic, null);
});
test('CLI subprocess receives only its own credential, never database or Discord secrets', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'care-firewall-test-'));
  const keys = ['VERCEL_SECURITY_CLI', 'PGPASSWORD', 'DISCORD_ALERT_WEBHOOK_URL', 'VERCEL_TOKEN'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  t.after(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } rmSync(dir, { recursive: true, force: true }); });
  const cli = join(dir, 'cli');
  writeFileSync(cli, `#!${process.execPath}\nif(process.env.PGPASSWORD||process.env.DISCORD_ALERT_WEBHOOK_URL||process.env.VERCEL_TOKEN!=='fixture-token')process.exit(1);console.log(JSON.stringify(process.argv.includes('traffic')?${JSON.stringify(traffic)}:{active:[],resolved:[]}));`, { mode: 0o755 });
  process.env.VERCEL_SECURITY_CLI = cli; process.env.PGPASSWORD = 'PRIVATE';
  process.env.DISCORD_ALERT_WEBHOOK_URL = 'PRIVATE'; process.env.VERCEL_TOKEN = 'fixture-token';
  const result = await collectFirewall({ environment: 'production', enabled: true, now });
  assert.equal(result.status, 'available');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('project token DDoS mode exports only active count and marks other Firewall sources incomplete', async () => {
  const result = await collectFirewall({ environment: 'production', enabled: true, mode: 'ddos-only', token: 'test-token', fetcher: async (url, init) => {
    assert.equal(url.searchParams.get('projectId'), 'prj_hM6VAEcC8T773hF48MSRHtkLKyl2');
    assert.equal(init.redirect, 'error');
    return Response.json({ anomalies: [{ startTime: '2026-10-27T00:00:00Z', endTime: null, affectedHostMap: { PRIVATE: { ip: 'SECRET' } } },
      { startTime: '2026-10-27T00:00:00Z', endTime: '2026-10-27T00:30:00Z' }] });
  } });
  assert.deepEqual(result, { status: 'incomplete', mode: 'ddos-only', traffic: null, alerts: null, ddos: { status: 'available', active: 1 } });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|test-token/);
});
test('DDoS source failure or malformed events remain unavailable, never healthy zero', async () => {
  for (const response of [new Response(null, { status: 403 }), Response.json({}), Response.json({ anomalies: [{ startTime: 'invalid' }] })]) {
    const result = await collectFirewall({ environment: 'production', enabled: true, mode: 'ddos-only', token: 'test-token', fetcher: async () => response });
    assert.deepEqual(result.ddos, { status: 'unavailable', active: null });
  }
});
