import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// GitHub's per-attempt start time is stable across retries inside an attempt.
// Never print the response or authorization token to logs.
export async function attemptStartedAt(env, request = fetch) {
  const {GITHUB_RUN_ID:runId,GITHUB_RUN_ATTEMPT:attempt,GITHUB_TOKEN:token} = env;
  if (env.GITHUB_REPOSITORY !== 'shougayaki-1/care-record' || env.GITHUB_API_URL !== 'https://api.github.com'
    || !/^[1-9][0-9]{0,19}$/.test(runId ?? '') || !/^[1-9][0-9]{0,5}$/.test(attempt ?? '')
    || !token || /[\r\n]/.test(token)) throw new Error('invalid');
  const url = new URL(`https://api.github.com/repos/shougayaki-1/care-record/actions/runs/${runId}/attempts/${attempt}`);
  url.searchParams.set('exclude_pull_requests','true');
  const response = await request(url, {headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json',
    'x-github-api-version':'2022-11-28'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)});
  if (!response.ok || response.redirected) throw new Error('invalid');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('invalid');
  const parts=[]; let size=0;
  try {
    for (;;) {
      const part=await reader.read();
      if (part.done) break;
      size+=part.value.byteLength;
      if (size>256*1024) throw new Error('invalid');
      parts.push(part.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  if (data?.repository?.full_name !== env.GITHUB_REPOSITORY || String(data.run_attempt) !== attempt
    || typeof data.run_started_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(data.run_started_at)
    || !Number.isFinite(Date.parse(data.run_started_at)) || Date.parse(data.run_started_at)>Date.now()
    || new Date(data.run_started_at).toISOString().replace('.000Z','Z') !== data.run_started_at) throw new Error('invalid');
  return data.run_started_at;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const startedAt=await attemptStartedAt(process.env);
    if (!process.env.GITHUB_OUTPUT) throw new Error('invalid');
    await appendFile(process.env.GITHUB_OUTPUT,`started_at=${startedAt}\n`,{encoding:'utf8'});
  } catch { console.error('audit_verification_run_metadata_unavailable'); process.exitCode=1; }
}
