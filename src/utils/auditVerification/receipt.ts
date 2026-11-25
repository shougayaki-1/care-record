import { z } from 'zod';
import { ArchiveFailure, encode, requireCondition, sha256, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { readExactArchiveObject } from '@/utils/auditArchive/publisher';

const inputSchema = z.strictObject({
  environment: z.enum(['local','staging','production']),
  runId: z.string().max(20).regex(/^[1-9][0-9]*$/),
  attempt: z.string().max(6).regex(/^[1-9][0-9]*$/),
  createdAt: z.iso.datetime(),
  category: z.enum(['mismatch','incomplete','unavailable']),
});

// Until v1 recomputation and every other gate are integrated, no function here
// can write a success receipt. Only fixed, non-sensitive failure categories are
// accepted. The caller must treat a write/readback failure as a failed run.
export async function writeFailureReceipt(store: Store, input: unknown): Promise<ObjectRef> {
  const parsed = inputSchema.safeParse(input);
  requireCondition(parsed.success);
  const { environment,runId,attempt,createdAt,category } = parsed.data;
  const name = `verification/${environment}/runs/${runId}/${attempt}.json`;
  const bytes = encode({schema:'audit-verification-result:1',environment,runId,attempt,
    runUrl:`https://github.com/shougayaki-1/care-record/actions/runs/${runId}`,
    verifierVersion:'audit-verifier:1',createdAt,status:category});
  try {
    const saved = await store.create(name,bytes);
    requireCondition(saved.ref.name === name && saved.ref.digest === sha256(bytes)
      && saved.ref.size === String(bytes.length) && saved.bytes.equals(bytes));
    const readback = await readExactArchiveObject(store,saved.ref);
    requireCondition(readback.bytes.equals(bytes));
    return saved.ref;
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    throw new ArchiveFailure('unavailable');
  }
}
