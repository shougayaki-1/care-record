import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { evidenceUrl, sendDiscord } from './discord.mjs';
import { collectFirewall } from './firewall.mjs';

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
const categories = [...Object.keys(rules), 'audit_gap_15m', 'schedule_gap', 'daily_summary', 'notification_probe', 'source_unavailable',
  'firewall_denies', 'firewall_active_alerts', 'firewall_source_gap', 'auth_invalid_credentials', 'auth_source_gap', 'ingestion_evidence_gap'];

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

export function payload(environment, link, category, severity, value, start, end, status = 'open', daily, firewall) {
  if (!['production', 'staging'].includes(environment) || !categories.includes(category)
    || !['Critical', 'High', 'Warning', 'Info'].includes(severity) || !count(value)
    || !timestamp(start) || !timestamp(end) || !['open', 'reminder', 'resolved', 'summary', 'test'].includes(status)
    || (daily && !['failures', 'successes', 'missing_hashes', 'important_events'].every(k => count(daily[k])))) throw new Error('invalid_alert');
  // The message contains only fixed text and validated counts, never raw records.
  const details = {
    failures_5m: ['ログイン失敗が短時間に増えています', 'すぐに管理画面のログイン履歴を確認し、心当たりのない試行がないか調べてください。'],
    failures_15m: ['ログイン失敗が増えています', 'すぐに管理画面のログイン履歴を確認し、心当たりのない試行がないか調べてください。'],
    spray_sources_15m: ['複数のアカウントへのログイン失敗がありました', 'すぐにログイン履歴を確認し、心当たりのない試行があれば対象の利用者に確認してください。'],
    distributed_targets_15m: ['同じアカウントへの複数の接続元からの失敗がありました', 'すぐにログイン履歴を確認し、対象の利用者に心当たりを確認してください。'],
    success_after_failures_15m: ['連続したログイン失敗の後に成功しました', 'すぐにログイン履歴を確認し、本人の操作か確認してください。'],
    missing_hashes_15m: ['ログイン履歴の一部に確認用情報がありません', '今日中に実行結果を開き、記録の設定とエラーを確認してください。'],
    audit_gap_15m: ['ログイン試行と監査記録の件数に差があります', '今日中にログイン履歴と監査ログを確認してください。認証方法の違いや集計時刻でも差が出ます。'],
    schedule_gap: ['セキュリティ監視が予定どおりに動いていません', '実行結果を開き、失敗や停止がないか確認してください。監視サービスの遅延の場合もあります。'],
    source_unavailable: ['監視に必要な情報を取得できません', 'すぐに実行結果を開き、データベースへの接続と監視設定を確認してください。'],
    firewall_denies: ['外部からのアクセスが多数拒否されました', 'VercelのFirewall画面でアクセス状況を確認してください。拒否だけでは被害があったとは限りません。'],
    firewall_active_alerts: ['Vercelがアクセスの異常を報告しています', 'VercelのFirewall画面でアラートを確認し、影響がないか調べてください。'],
    firewall_source_gap: ['Firewallの情報を取得できません', '今日中に実行結果を開き、Vercelの接続設定と権限を確認してください。'],
    auth_invalid_credentials: ['認証サービスでログイン失敗が増えています', 'すぐにSupabaseの認証ログを確認し、心当たりのない試行がないか調べてください。'],
    ingestion_evidence_gap: ['認証サービスとアプリの記録に差があります', '認証サービスでは失敗が見つかりましたが、アプリの記録は見つかりません。アプリの記録エラーと直接アクセスの有無を確認してください。'],
    auth_source_gap: ['認証サービスのログを取得できません', '今日中に実行結果を開き、Supabaseのログ取得設定と権限を確認してください。'],
    daily_summary: ['前日のセキュリティ集計', '件数に気になる変化がないか確認してください。重要操作には正常な操作も含まれます。'],
    notification_probe: ['通知テスト', 'テスト通知です。この通知が届いていれば、特別な対応は不要です。'],
  };
  const [title, action] = details[category];
  const statusText = { open: '発生', reminder: '継続中', resolved: '解消', summary: '日次集計', test: 'テスト' }[status];
  const urgency = { Critical: '至急確認', High: '早めに確認', Warning: '今日中に確認', Info: 'お知らせ' }[severity];
  const format = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  const dailyText = daily ? `\n前日のログイン失敗 ${daily.failures}件・成功 ${daily.successes}件・確認用情報なし ${daily.missing_hashes}件・重要操作 ${daily.important_events}件` : '';
  const firewallText = category === 'daily_summary' && firewall?.traffic && count(firewall.traffic.counts?.deny) ? `\n前日のアクセス拒否 ${firewall.traffic.counts.deny}件` : '';
  const countText = category === 'source_unavailable' ? '' : `\n件数: ${value}件`;
  const instruction = status === 'resolved' ? '監視上の数値は落ち着きました。必要に応じて、それまでの履歴を確認してください。' : action;
  return {
    content: `[CareRecord] ${environment === 'production' ? '本番' : 'テスト環境'}｜${urgency}｜${statusText}｜${title}`,
    embeds: [{ description: `**何をすればいい？**\n${instruction}${countText}${dailyText}${firewallText}\n期間: ${format(start)} 〜 ${format(end)}（日本時間）\n攻撃や被害があったと確定した通知ではありません。\n実行結果: ${evidenceUrl(link)}`,
      footer: { text: `${category} | ${status}` } }],
  };
}

// Injected IO allows complete synthetic runs with no real Discord/DB access.
export async function runMonitor({ snapshot, save, notify, environment, link, probe = false, firewall = { status: 'disabled' }, firewallDaily, auth = { status: 'disabled' } }) {
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
    try { await notify(payload(environment, link, ...args.slice(0, 6), args[6], args[0] === 'daily_summary' ? firewallDaily : firewall)); return true; }
    catch { deliveryFailures++; deliveryUnavailable = true; return false; }
  };
  const authValid = auth.status === 'available' && count(auth.invalid_credentials) && timestamp(auth.start) && timestamp(auth.end) && Date.parse(auth.end) - Date.parse(auth.start) === 15 * 60000 && Math.abs(now - Date.parse(auth.end)) <= 5 * 60000;
  const metrics = { ...s.metrics, audit_gap_15m: Math.abs(s.metrics.attempts_15m - s.metrics.audit_logins_15m),
    schedule_gap: !timestamp(previous.last_observed) || now - Date.parse(previous.last_observed) > 20 * 60000 ? 1 : 0,
    firewall_denies: firewall.traffic && count(firewall.traffic.counts?.deny) && Date.parse(firewall.traffic.end) - Date.parse(firewall.traffic.start) <= 30 * 60000 ? firewall.traffic.counts.deny : null,
    firewall_active_alerts: count(firewall.alerts?.active) ? firewall.alerts.active : null,
    auth_invalid_credentials: authValid ? auth.invalid_credentials : null,
    auth_source_gap: auth.status === 'disabled' ? null : authValid ? 0 : 1,
    ingestion_evidence_gap: authValid ? (auth.invalid_credentials >= 3 && s.metrics.attempts_15m === 0 && s.metrics.audit_logins_15m === 0 ? 1 : 0) : null,
    firewall_source_gap: firewall.status === 'disabled' ? null : firewall.status === 'available' && (!firewallDaily || firewallDaily.status === 'available') ? 0 : 1,
  };
  const allRules = { ...rules, audit_gap_15m: { high: 3, clear: 0, severity: 'Warning' }, schedule_gap: { high: 1, clear: 0, severity: 'Warning' },
    firewall_denies: { high: 20, clear: 5, severity: 'High' }, firewall_active_alerts: { high: 1, clear: 0, severity: 'High' },
    firewall_source_gap: { high: 1, clear: 0, severity: 'Warning' },
    auth_invalid_credentials: { high: 50, clear: 10, severity: 'High' }, auth_source_gap: { high: 1, clear: 0, severity: 'Warning' },
    ingestion_evidence_gap: { high: 1, clear: 0, severity: 'Warning' } };
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
    if ((key.startsWith('auth_') || key === 'ingestion_evidence_gap') && auth.status === 'disabled') { state.alerts[key].clears = 0; continue; }
    if (key.startsWith('firewall_') && firewall.status === 'disabled') { state.alerts[key].clears = 0; continue; }
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
    if (value === null) { state.alerts[key].clears = 0; continue; } // Missing data breaks consecutive recovery observations.
    let next = { active, sent: sent ? new Date(sent).toISOString() : null, clears: 0 };
    let status;
    if (value >= rule.high && (!active || now - sent >= 60 * 60000)) status = active ? 'reminder' : 'open';
    else if (active && value <= rule.clear) {
      next.clears = clears + 1;
      if (next.clears >= 2) status = 'resolved';
    }
    if (status) {
      const start = key === 'auth_invalid_credentials' ? auth.start : key === 'firewall_denies' ? firewall.traffic.start : new Date(now - (key.endsWith('_5m') ? 5 : key === 'schedule_gap' ? 20 : 15) * 60000).toISOString();
      const end = key === 'auth_invalid_credentials' ? auth.end : key === 'firewall_denies' ? firewall.traffic.end : s.observed_at;
      // Persist an outbox entry BEFORE attempting delivery; failures survive even
      // if the triggering time window has expired by the next successful run.
      state.alerts[key] = { ...next, pending: { value, start, end, status } };
      await persist();
      if (await deliver(key, status === 'resolved' ? 'Info' : rule.severity, value, start, end, status)) {
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
  return { deliveryFailures, source: 'available', firewall: firewall.status, authDirect: 'unverified', ingestion: 'unverified' };
}

function sql(query) {
  // libpq environment only: credentials never appear in argv/output. No shell.
  return execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: `SET statement_timeout='20s'; SET timezone='UTC'; ${query}`, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 65536,
  }).trim();
}

export function readMonitorSnapshot() {
  return validateSnapshot(JSON.parse(sql('SELECT private.security_monitor_snapshot();')));
}

export async function saveMonitorState(version, state) {
  if (!count(version)) throw new Error('invalid_version');
  const hex = Buffer.from(JSON.stringify(state)).toString('hex');
  const next = Number(sql(`SELECT private.security_monitor_save(${version}, convert_from(decode('${hex}','hex'),'UTF8')::jsonb);`));
  if (!count(next)) throw new Error('invalid_version');
  return next;
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
    const snapshot = readMonitorSnapshot();
    const enabled = process.env.SECURITY_FIREWALL_ENABLED === 'true';
    const firewall = await collectFirewall({ environment, enabled });
    const firewallDaily = snapshot.state.daily_end !== snapshot.day_end ? await collectFirewall({ environment, enabled, since: '24h' }) : undefined;
    let auth = { status: 'disabled' };
    if (process.env.SECURITY_AUTH_LOGS_ENABLED === 'true') {
      try {
        const collected = JSON.parse(readFileSync(process.env.AUTH_LOGS_RESULT_FILE, 'utf8'));
        auth = collected && typeof collected === 'object' && !Array.isArray(collected) ? collected : { status: 'unavailable' };
      } catch { auth = { status: 'unavailable' }; }
    }
    const result = await runMonitor({ snapshot, environment, link, notify, auth,
      firewall, firewallDaily,
      probe: process.env.SECURITY_MONITOR_PROBE === 'true',
      save: saveMonitorState,
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
