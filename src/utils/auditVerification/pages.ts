import { ArchiveFailure, MAX_BYTES, pageSchema, requireCondition, type Cursor } from '@/utils/auditArchive/contracts';
import { SnapshotChain } from './snapshot';

function after(a: NonNullable<Cursor>, b: NonNullable<Cursor>) {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  if (a[2] !== b[2]) return BigInt(a[2]) > BigInt(b[2]);
  return a[3] > b[3];
}

// A run is not complete until the final page is received. This function checks
// transport and in-DB chain shape only; it never issues a verification verdict.
export async function readSnapshotPages(
  page: (cursor: Cursor) => Promise<unknown>, deadline: number, now = Date.now,
) {
  const chain = new SnapshotChain();
  let cursor: Cursor = null;
  let pages = 0;
  let rows = 0;
  const seen = new Set<string>();
  for (;;) {
    if (now() >= deadline || pages >= 10000) throw new ArchiveFailure('incomplete');
    const raw = await page(cursor);
    if (now() >= deadline) throw new ArchiveFailure('incomplete');
    let parsed;
    try {
      const text = JSON.stringify(raw);
      requireCondition(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_BYTES);
      parsed = pageSchema.parse(raw);
    } catch { throw new ArchiveFailure('mismatch'); }
    pages++;
    rows += parsed.items.length;
    if (rows > 200_000) throw new ArchiveFailure('incomplete');
    requireCondition(!parsed.more || (parsed.items.length > 0 && parsed.cursor !== null));
    if (parsed.items.length) {
      const last = parsed.items[parsed.items.length - 1];
      const expected = [last.kind,last.scope,last.sequence,last.kind === 'head' ? '00000000-0000-0000-0000-000000000000' : last.id];
      requireCondition(parsed.cursor && JSON.stringify(parsed.cursor) === JSON.stringify(expected));
      const key = JSON.stringify(parsed.cursor);
      requireCondition(!seen.has(key));
      seen.add(key);
      for (const item of parsed.items) {
        const itemCursor: NonNullable<Cursor> = [item.kind, item.scope, item.sequence, item.kind === 'head' ? '00000000-0000-0000-0000-000000000000' : item.id];
        requireCondition(cursor === null || after(itemCursor, cursor));
        chain.accept(item);
        cursor = itemCursor;
      }
    } else {
      requireCondition(JSON.stringify(parsed.cursor) === JSON.stringify(cursor));
    }
    if (!parsed.more) return { chain, snapshot:chain.finish(), pages };
  }
}
