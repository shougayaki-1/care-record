import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { archiveConfig } from '@/utils/auditArchive/config';
import { ArchiveFailure, cursorSchema, digest, MAX_BYTES, pageSchema, requireCondition } from '@/utils/auditArchive/contracts';
import { loadControl } from '@/utils/auditArchive/publisher';
import { withinDeadline } from '@/utils/auditVerification/deadline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
const MAX_REQUEST_BYTES = 16 * 1024;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Content-Type': 'application/json' };
const cursor = cursorSchema.refine(value => value === null || /^(global|org:[0-9a-f-]{36})$/.test(value[1]));
const input = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('begin') }),
  z.strictObject({ operation: z.literal('page'), run: z.uuid(), cursor }),
  z.strictObject({ operation: z.literal('recompute'), run: z.uuid(), ids: z.array(z.uuid()).min(1).max(100)
    .refine(ids => new Set(ids).size === ids.length), timeZone: z.string().min(1).max(128),
    dateStyle: z.string().regex(/^(ISO|SQL|Postgres|German), (MDY|DMY|YMD)$/) }),
]);
const recomputed = z.array(z.strictObject({ id: z.uuid(), hash: digest })).max(100);

function json(value: unknown, status: number) {
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes, 'utf8') > MAX_BYTES) throw new ArchiveFailure('mismatch');
  return new NextResponse(bytes, { status, headers });
}

// Reject oversized bodies even if Content-Length is missing or misleading.
async function readInput(request: NextRequest) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d{1,8}$/.test(length) || BigInt(length) > BigInt(MAX_REQUEST_BYTES))) throw new Error('invalid_request');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_request');
  const parts: Uint8Array[] = [];
  let size = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 15_000);
  try {
    while (true) {
      const part = await reader.read();
      if (timedOut) throw new Error('invalid_request');
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new Error('invalid_request');
      parts.push(part.value);
    }
    return input.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))));
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

// Internal transport only. A successful response is not a verification verdict.
export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ status: 'unauthorized' }, 401);
  }
  if (process.env.AUDIT_VERIFICATION_API_ENABLED !== 'true') return json({ status: 'unavailable' }, 503);
  const deadline = Date.now() + 25_000;
  try {
    const config = archiveConfig();
    if (request.headers.get('x-carerecord-environment') !== config.environment) return json({ status: 'environment_mismatch' }, 403);
    if (config.mode !== 'v2') return json({ status: 'incomplete' }, 503);
    let body: z.infer<typeof input>;
    try { body = await readInput(request); } catch { return json({ status: 'invalid_request' }, 400); }
    if (Date.now() >= deadline) return json({ status: 'incomplete' }, 503);
    if (body.operation === 'begin') {
      // Do not start a persistent snapshot without the pinned, finalized control.
      const { createArchiveStore } = await import('@/utils/auditArchive/gcs');
      const store = createArchiveStore(config.bucket, `verification/${config.environment}/`);
      const control = await withinDeadline(() => loadControl(store, config.pinned, config.environment), deadline);
      requireCondition(control.baselineFinalized && control.baseline !== null);
    }
    if (Date.now() >= deadline) return json({ status: 'incomplete' }, 503);
    const { createVerificationSource } = await import('@/utils/auditVerification/source');
    const remaining = deadline - Date.now();
    if (remaining <= 0) return json({ status: 'incomplete' }, 503);
    const source = createVerificationSource(AbortSignal.timeout(remaining));
    if (body.operation === 'begin') {
      const run = z.uuid().safeParse(await withinDeadline(() => source.begin(), deadline));
      requireCondition(run.success);
      return json({ run: run.data }, 200);
    }
    if (body.operation === 'page') {
      const page = pageSchema.safeParse(await withinDeadline(() => source.page(body.run, body.cursor), deadline));
      requireCondition(page.success);
      return json(page.data, 200);
    }
    if (!source.recompute) throw new ArchiveFailure('unavailable');
    const result = recomputed.safeParse(await withinDeadline(() => source.recompute!(body.run, body.ids, body.timeZone, body.dateStyle), deadline));
    requireCondition(result.success && result.data.length === body.ids.length
      && result.data.every((row, index) => row.id === body.ids[index]));
    return json({ rows: result.data }, 200);
  } catch (error) {
    if (Date.now() >= deadline) return json({ status: 'incomplete' }, 503);
    const category = error instanceof ArchiveFailure && error.category !== 'not_configured' ? error.category : 'unavailable';
    return json({ status: category }, 503);
  }
}
