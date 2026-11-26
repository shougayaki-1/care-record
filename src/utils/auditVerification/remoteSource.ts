import { z } from 'zod';
import { ArchiveFailure, cursorSchema, digest, MAX_BYTES, pageSchema, requireCondition } from '@/utils/auditArchive/contracts';
import type { VerificationSnapshotSource } from './inspect';

const environmentSchema = z.enum(['local','staging','production']);
const resultRows = z.array(z.strictObject({id:z.uuid(),hash:digest})).max(100);
const failure = z.strictObject({status:z.enum(['incomplete','mismatch','unavailable'])});
type Fetch = (input: URL, init: RequestInit) => Promise<Response>;

// The origin is a deployment-controlled fixed HTTPS origin, never an input
// received from an API request. Redirects are forbidden before sending secrets.
export function createRemoteVerificationSource(origin: string, environment: string, secret: string, request: Fetch = fetch): VerificationSnapshotSource {
  let endpoint: URL;
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash
      || base.origin !== origin || !environmentSchema.safeParse(environment).success || !secret || /[\r\n]/.test(secret)) {
      throw new Error('invalid configuration');
    }
    endpoint = new URL('/api/cron/verify-audit', base);
  } catch { throw new ArchiveFailure('not_configured'); }

  async function call(body: unknown, signal?: AbortSignal) {
    const bytes = JSON.stringify(body);
    requireCondition(Buffer.byteLength(bytes, 'utf8') <= 16 * 1024);
    let response: Response;
    try {
      response = await request(endpoint, {method:'POST',headers:{authorization:`Bearer ${secret}`,
        'content-type':'application/json','x-carerecord-environment':environment},body:bytes,
        cache:'no-store',redirect:'error',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000)});
    } catch { throw new ArchiveFailure('unavailable'); }
    if (response.redirected || response.status >= 300 && response.status < 400) throw new ArchiveFailure('unavailable');
    const directives = (response.headers.get('cache-control') ?? '').toLowerCase().split(',')
      .map(value => value.trim().split('=',1)[0].trim());
    if (!directives.includes('private') || !directives.includes('no-store')) throw new ArchiveFailure('unavailable');
    const length = response.headers.get('content-length');
    if (length && (!/^\d{1,8}$/.test(length) || Number(length) > MAX_BYTES)) throw new ArchiveFailure('unavailable');
    const reader = response.body?.getReader();
    if (!reader) throw new ArchiveFailure('unavailable');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BYTES) throw new ArchiveFailure('unavailable');
        chunks.push(part.value);
      }
    } catch (error) {
      if (error instanceof ArchiveFailure) throw error;
      throw new ArchiveFailure('unavailable');
    } finally { void reader.cancel().catch(() => {}); }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
    catch { throw new ArchiveFailure('mismatch'); }
    if (!response.ok) {
      const parsed = failure.safeParse(value);
      throw new ArchiveFailure(parsed.success ? parsed.data.status : 'unavailable');
    }
    return value;
  }
  return {
    async begin(signal) {
      const result = z.strictObject({run:z.uuid()}).safeParse(await call({operation:'begin'},signal));
      requireCondition(result.success);
      return result.data.run;
    },
    async page(run,cursor,signal) {
      requireCondition(z.uuid().safeParse(run).success && cursorSchema.safeParse(cursor).success);
      const result = pageSchema.safeParse(await call({operation:'page',run,cursor},signal));
      requireCondition(result.success);
      return result.data;
    },
    async recompute(run,ids,timeZone,dateStyle,signal) {
      requireCondition(z.uuid().safeParse(run).success && ids.length > 0 && ids.length <= 100
        && ids.every(id => z.uuid().safeParse(id).success) && new Set(ids).size === ids.length
        && timeZone.length > 0 && timeZone.length <= 128 && /^(ISO|SQL|Postgres|German), (MDY|DMY|YMD)$/.test(dateStyle));
      const result = z.strictObject({rows:resultRows}).safeParse(await call({operation:'recompute',run,ids,timeZone,dateStyle},signal));
      requireCondition(result.success && result.data.rows.length === ids.length && result.data.rows.every((row,i) => row.id === ids[i]));
      return result.data.rows;
    },
  };
}
