// Transport never logs URLs, response bodies, or exception messages.
export function evidenceUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
    || !/^\/shougayaki-1\/care-record\/actions\/runs\/\d+$/.test(url.pathname)) throw new Error('invalid_evidence');
  return url.href;
}

export async function sendDiscord(webhook, payload, { fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const url = new URL(webhook);
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password
    || url.search || url.hash || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error('invalid_webhook');
  // wait=true ensures Discord acknowledges message creation. No redirects with credentials.
  url.searchParams.set('wait', 'true');
  for (let attempt = 0; attempt < 4; attempt++) {
    let retryAfter = 0;
    try {
      const response = await fetcher(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
      });
      const status = response.status;
      const header = response.headers.get('retry-after');
      retryAfter = header === null ? 0 : Number(header);
      if (!Number.isFinite(retryAfter)) retryAfter = Math.max(0, (Date.parse(header) - Date.now()) / 1000);
      await response.body?.cancel();
      if (response.ok) return;
      if (status !== 429 && status < 500) throw new Error('permanent_delivery_failure');
    } catch (error) {
      if (error?.message === 'permanent_delivery_failure') throw new Error('discord_delivery_failed');
    }
    // Long rate limits are retried by the next run without acknowledging this alert.
    if (attempt === 3 || retryAfter > 30) break;
    await sleep(Math.max(1000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0));
  }
  throw new Error('discord_delivery_failed');
}
