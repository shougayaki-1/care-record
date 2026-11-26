import { pathToFileURL } from 'node:url';

// This dependency-free fallback also runs when npm installation has failed.
// Delivery may be ambiguous on timeout; callers must still fail the job.
export async function notifyPreflightFailure(env, request = fetch) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'shougayaki-1/care-record'
    || env.GITHUB_SERVER_URL !== 'https://github.com' || !['workflow_dispatch','schedule'].includes(env.GITHUB_EVENT_NAME)
    || !['staging','production'].includes(env.APP_ENV) || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? '')) throw new Error('invalid');
  const url = new URL(env.DISCORD_ALERT_WEBHOOK_URL ?? '');
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password
    || url.search || url.hash || !/^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+$/.test(url.pathname)) throw new Error('invalid');
  url.searchParams.set('wait','true');
  const content=`Critical | ${env.APP_ENV} | unavailable | https://github.com/shougayaki-1/care-record/actions/runs/${env.GITHUB_RUN_ID}`;
  const response=await request(url,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000),
    headers:{'Content-Type':'application/json'},body:JSON.stringify({content,allowed_mentions:{parse:[]}})});
  if (response.status !== 200 || response.redirected) throw new Error('invalid');
  const reader=response.body?.getReader();
  if (!reader) throw new Error('invalid');
  const parts=[]; let size=0;
  try {
    for (;;) {
      const part=await reader.read(); if (part.done) break;
      size+=part.value.byteLength; if (size>64*1024) throw new Error('invalid');
      parts.push(part.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  if (typeof value?.id !== 'string' || !/^[0-9]+$/.test(value.id)) throw new Error('invalid');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  notifyPreflightFailure(process.env).catch(() => {
    console.error('audit_verification_notification_failed'); process.exitCode=1;
  });
}
