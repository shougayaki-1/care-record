import { z } from 'zod';
import { ArchiveFailure, requireCondition, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import type { VerificationSnapshotSource } from './inspect';
import { runMetadataSchema } from './receipt';
import { runVerification } from './run';

const categorySchema = z.enum(['mismatch', 'incomplete', 'unavailable']);
type Request = (input: URL, init: RequestInit) => Promise<Response>;

// Marks only a confirmed alert; all other failures may need a fallback alert.
export class NotifiedVerificationFailure extends ArchiveFailure {}

// The webhook is deployment configuration, not a request parameter. Discord's
// wait=true is necessary: without it an unsaved message may still return 204.
function webhookUrl(webhook: string): URL {
  let url: URL;
  try {
    url = new URL(webhook);
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password
      || url.search || url.hash || !/^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+$/.test(url.pathname)) throw new Error();
    url.searchParams.set('wait', 'true');
  } catch { throw new ArchiveFailure('not_configured'); }
  return url;
}

export async function notifyVerificationFailure(metadata: unknown, category: unknown, webhook: string, request: Request = fetch) {
  const parsed = runMetadataSchema.safeParse(metadata);
  const status = categorySchema.safeParse(category);
  requireCondition(parsed.success && status.success);
  const url = webhookUrl(webhook);
  const { environment, runId } = parsed.data;
  const content = `Critical | ${environment} | ${status.data} | https://github.com/shougayaki-1/care-record/actions/runs/${runId}`;
  try {
    const response = await request(url, { method: 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(10_000), headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content, allowed_mentions: {parse: []}}) });
    if (response.status !== 200 || response.redirected) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 64 * 1024) throw new Error();
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    const message: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
    if (!z.object({id: z.string().regex(/^[0-9]+$/)}).safeParse(message).success) throw new Error();
  } catch { throw new ArchiveFailure('unavailable'); }
}

// Every current result is non-success. Propagate it after notification so the
// runner cannot accidentally exit successfully; no audit detail is included.
export async function runVerificationWithNotification(
  metadata: unknown, archiveStore: Store, receiptStore: Store, pinnedControl: ObjectRef,
  source: VerificationSnapshotSource, webhook: string, settingsPin?: ObjectRef, budgetMs?: number,
  request: Request = fetch,
) {
  requireCondition(runMetadataSchema.safeParse(metadata).success);
  webhookUrl(webhook); // Fail before creating a snapshot if notification is not configured.
  let result: Awaited<ReturnType<typeof runVerification>>;
  try {
    result = await runVerification(metadata, archiveStore, receiptStore, pinnedControl, source, settingsPin, budgetMs);
  } catch {
    await notifyVerificationFailure(metadata, 'unavailable', webhook, request);
    throw new NotifiedVerificationFailure('unavailable');
  }
  await notifyVerificationFailure(metadata, result.status, webhook, request);
  throw new NotifiedVerificationFailure(result.status);
}
