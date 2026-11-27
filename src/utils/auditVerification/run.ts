import { ArchiveFailure, requireCondition, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { withinDeadline } from './deadline';
import { inspectPreservation, type VerificationSnapshotSource } from './inspect';
import { runMetadataSchema, writeFailureReceipt } from './receipt';
import { verificationStores } from './stores';

type NonSuccess = 'mismatch' | 'incomplete' | 'unavailable';

// There is deliberately no success path until all verification gates and the
// treatment of unresolved v1 history have an approved, testable contract.
// The caller supplies stable run metadata across retries. The receipt store's
// credentials must be limited to its verification prefix independently of DB.
export async function runVerification(
  metadata: unknown, archiveStore: Store, receiptStore: Store, pinnedControl: ObjectRef,
  source: VerificationSnapshotSource, settingsPin?: ObjectRef, budgetMs = 30 * 60 * 1000,
) {
  const parsed = runMetadataSchema.safeParse(metadata);
  requireCondition(parsed.success);
  if (!Number.isInteger(budgetMs) || budgetMs < 2 || budgetMs > 30 * 60 * 1000) throw new ArchiveFailure('incomplete');
  const scoped = verificationStores(parsed.data.environment, archiveStore, receiptStore);
  const deadline = Date.now() + budgetMs;
  const reserve = Math.min(60_000, Math.floor(budgetMs / 2));
  let status: NonSuccess;
  let target: { cutoverId:string; ordinal:string; ref:ObjectRef } | undefined;
  try {
    const evidence = await withinDeadline(signal => inspectPreservation(scoped.archiveStore, pinnedControl, parsed.data.environment, source, budgetMs - reserve, settingsPin, signal, value => { target=value; }), deadline - reserve);
    target = { cutoverId:evidence.cutoverId, ordinal:evidence.targetOrdinal, ref:evidence.targetManifest };
    status = 'incomplete'; // evidence_only is not a successful verification
  } catch (error) {
    status = error instanceof ArchiveFailure && error.category !== 'not_configured' ? error.category : 'unavailable';
  }
  // A failed write, readback, or deadline must never be treated as a result.
  const receipt = await withinDeadline(() => writeFailureReceipt(scoped.receiptStore, {...parsed.data,category:status,...(target ? {target} : {})}), deadline);
  return { status, receipt };
}
