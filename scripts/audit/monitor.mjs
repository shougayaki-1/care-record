// Connect to an independent hourly monitor after environment approval. This
// does not run the archive itself and never prints the API body or secrets.
const environment = process.env.APP_ENV;
const origin = process.env.AUDIT_MONITOR_ORIGIN;
const secret = process.env.CRON_SECRET;
const webhook = process.env.DISCORD_ALERT_WEBHOOK_URL;
const evidence = process.env.EVIDENCE_URL;
let category = 'archive_unavailable';
try {
  if (!['staging', 'production'].includes(environment) || !secret || !origin) throw new Error();
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
  url.pathname = '/api/cron/archive-audit';
  url.searchParams.set('mode', 'health');
  const response = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(30_000), cache: 'no-store',
    headers: { authorization: `Bearer ${secret}`, 'x-carerecord-environment': environment },
  });
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw new Error();
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  const result = JSON.parse(Buffer.concat(chunks).toString());
  if (response.ok && result.ok === true && result.category === 'archive_current') process.exit(0);
  if (['archive_stale', 'archive_incomplete'].includes(result.category)) category = result.category;
} catch { /* Fixed category only. */ }
try {
  if (!webhook || !['staging', 'production'].includes(environment)) throw new Error();
  const url = new URL(webhook);
  const link = new URL(evidence);
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || !url.pathname.startsWith('/api/webhooks/')
    || link.origin !== 'https://github.com' || !/^\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(link.pathname)
    || link.search || link.hash) throw new Error();
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `Critical | ${environment} | ${category} | ${link.href}`, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error();
} catch { console.error('audit_monitor_notification_failed'); }
console.error(category);
process.exitCode = 1;
