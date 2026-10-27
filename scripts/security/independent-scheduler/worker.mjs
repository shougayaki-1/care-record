const API = 'https://api.github.com/repos/shougayaki-1/care-record';
const HEADERS = { accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'care-record-security-scheduler' };

async function request(fetcher, url, options = {}) {
  const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('request_failed');
  return response;
}

async function readJson(response) {
  if (!response.body) throw new Error('missing_body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error('response_too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function run(env, fetcher = fetch, now = Date.now()) {
  let failure = false;
  const githubHeaders = { ...HEADERS, authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN || ''}` };
  try {
    const runs = await readJson(await request(fetcher, `${API}/actions/workflows/security-monitor.yml/runs?branch=main&per_page=30`, { headers: githubHeaders }));
    if (!Array.isArray(runs.workflow_runs)) throw new Error('invalid_runs');
    let healthy = false;
    for (const run of runs.workflow_runs) {
      const time = Date.parse(run.created_at);
      if (!Number.isSafeInteger(run.id) || run.head_branch !== 'main' || run.status !== 'completed' || !['workflow_dispatch', 'schedule'].includes(run.event) || !Number.isFinite(time) || time > now || now - time > 20 * 60000) continue;
      const jobs = await readJson(await request(fetcher, `${API}/actions/runs/${run.id}/jobs?per_page=100`, { headers: githubHeaders }));
      if (!Array.isArray(jobs.jobs)) throw new Error('invalid_jobs');
      if (jobs.jobs.some(job => job.name === 'monitor (production)' && job.conclusion === 'success' && Array.isArray(job.steps) && job.steps.some(step => step.name === 'Collect counts and deliver pending alerts' && step.conclusion === 'success'))) { healthy = true; break; }
    }
    if (!healthy) failure = true;
  } catch { failure = true; }
  try {
    if (!env.GITHUB_DISPATCH_TOKEN) throw new Error('missing_token');
    await request(fetcher, `${API}/actions/workflows/security-monitor.yml/dispatches`, { method: 'POST', headers: { ...githubHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
  } catch { failure = true; }
  if (failure) {
    if (!env.DISCORD_WEBHOOK_URL) throw new Error('missing_notification');
    await request(fetcher, env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '【本番・要確認】セキュリティ監視の直近20分の成功を確認できないか、定期起動に失敗しました。GitHub Actions の実行履歴と Cloudflare の実行状況を確認し、必要に応じて手動で監視を実行してください。 https://github.com/shougayaki-1/care-record/actions/workflows/security-monitor.yml', allowed_mentions: { parse: [] } }) });
    throw new Error('security_monitor_unverified');
  }
}
const worker = { async scheduled(_controller, env) { await run(env); } };
export default worker;
