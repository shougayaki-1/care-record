import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const team = 'team_ysW0wFQFYn4lGeDbqSnJtdDc';
const projects = { production: 'prj_hM6VAEcC8T773hF48MSRHtkLKyl2', staging: 'prj_B1IUy7IKAuHXDWEelGooUkOR7Hgd' };
const actions = ['allow', 'deny', 'challenge', 'log', 'bypass', 'rate_limit', 'redirect'];
const count = n => Number.isSafeInteger(n) && n >= 0;

// Reconstruct a count-only result even if an upstream CLI adds raw dimensions.
// Unknown actions cannot silently become a healthy zero.
export function projectTraffic(data, now = Date.now()) {
  const start = Date.parse(data?.period?.start), end = Date.parse(data?.period?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
    || end - start > 26 * 3600000 || end > now + 3600000 || end < now - 20 * 60000
    || !data.stats || typeof data.stats !== 'object' || Array.isArray(data.stats)
    || !Object.entries(data.stats).every(([key, value]) => actions.includes(key) && count(value))) throw new Error('firewall_invalid_traffic');
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    counts: Object.fromEntries(actions.map(key => [key, data.stats[key] ?? 0])) };
}
export function projectAlerts(data) {
  if (!Array.isArray(data?.active) || !Array.isArray(data?.resolved)
    || data.active.length > 10000 || data.resolved.length > 10000) throw new Error('firewall_invalid_alerts');
  // Alert IDs, paths, IPs and arbitrary messages never leave this adapter.
  return { active: data.active.length, resolved: data.resolved.length };
}

export async function collectFirewall({ environment, enabled, runner, now = Date.now(), since = '15m' }) {
  if (!Object.hasOwn(projects, environment)) throw new Error('firewall_invalid_environment');
  if (!enabled) return { status: 'disabled' };
  if (!['15m', '24h'].includes(since)) throw new Error('firewall_invalid_window');
  const run = runner ?? (async args => {
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'VERCEL_TOKEN', 'NODE_EXTRA_CA_CERTS', 'CI']
      .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const { stdout } = await exec(process.env.VERCEL_SECURITY_CLI || 'vercel', args, {
      timeout: 45000, maxBuffer: 262144, encoding: 'utf8',
      env: { ...env, VERCEL_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    });
    return JSON.parse(stdout);
  });
  const common = ['--scope', team, '--project', projects[environment], '--since', since, '--json'];
  // Failures are independent: a missing alerts permission must not hide traffic,
  // and a missing traffic query must not become an alert-free result.
  const [traffic, alerts] = await Promise.allSettled([
    run(['firewall', 'traffic', 'list', ...common, '--dimension', 'action']).then(d => {
      const traffic = projectTraffic(d, now);
      if (since === '15m' && Date.parse(traffic.end) - Date.parse(traffic.start) > 30 * 60000) throw new Error('firewall_invalid_window');
      return traffic;
    }),
    run(['firewall', 'alerts', 'list', ...common]).then(projectAlerts),
  ]);
  return {
    status: traffic.status === 'fulfilled' && alerts.status === 'fulfilled' ? 'available' : 'incomplete',
    traffic: traffic.status === 'fulfilled' ? traffic.value : null,
    alerts: alerts.status === 'fulfilled' ? alerts.value : null,
  };
}
