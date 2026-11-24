import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const projectRefs = { staging: 'xhvvfovvlqzlkirpjocv', production: 'ougdmklcwargnmaphkdn' };
const query = "select countIf(position(log_attributes['error_code'], 'invalid_credentials') > 0) as invalid_credentials from logs where source = 'auth_logs'";
const count = n => Number.isSafeInteger(n) && n >= 0;

// This API can return sensitive logs; request a fixed aggregate only and never
// print response bodies or errors. An empty aggregate is not proof of ingestion.
export async function collectAuthLogs({ environment, project, token, fetcher = fetch, now = Date.now() }) {
  if (!Object.hasOwn(projectRefs, environment) || project !== projectRefs[environment] || !token || !Number.isFinite(now)) throw new Error('invalid_auth_config');
  const end = new Date(Math.floor(now / 1000) * 1000);
  const start = new Date(end.getTime() - 15 * 60000);
  const url = new URL(`https://api.supabase.com/v1/projects/${project}/analytics/endpoints/logs`);
  url.search = new URLSearchParams({ sql: query, iso_timestamp_start: start.toISOString().replace('.000Z', 'Z'), iso_timestamp_end: end.toISOString().replace('.000Z', 'Z') });
  try {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('unavailable');
    const body = await response.text();
    if (body.length > 16384) throw new Error('oversized_response');
    const data = JSON.parse(body);
    const value = data?.result?.[0]?.invalid_credentials;
    if (!Array.isArray(data?.result) || data.result.length !== 1 || !count(value)) throw new Error('invalid_response');
    return { status: 'available', invalid_credentials: value, start: start.toISOString(), end: end.toISOString() };
  } catch { return { status: 'unavailable' }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let result = { status: 'unavailable' };
  try { result = await collectAuthLogs({ environment: process.env.APP_ENV, project: process.env.SECURITY_MONITOR_PROJECT_REF, token: process.env.SUPABASE_ACCESS_TOKEN }); } catch {}
  // The caller chooses a private runner temporary file; no raw provider data.
  writeFileSync(process.env.AUTH_LOGS_RESULT_FILE, JSON.stringify(result), { mode: 0o600 });
}
