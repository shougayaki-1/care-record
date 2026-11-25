import { z } from 'zod';
import { ArchiveFailure, requireCondition, type Cursor, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { readPreservedArchive } from '@/utils/auditArchive/publisher';
import { readSnapshotPages } from './pages';
import { comparePreservation } from './preservation';
import { compareLegacyStructure, readLegacyClassification } from './legacy';

export interface VerificationSnapshotSource {
  begin(): Promise<string>;
  page(run: string, cursor: Cursor): Promise<unknown>;
}

async function withinDeadline<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ArchiveFailure('incomplete');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ArchiveFailure('incomplete')), remaining); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

// Internal evidence only: never a verification success or a result receipt.
// Historical v1 findings and independent monitoring are not decided here.
export async function inspectPreservation(
  store: Store, pinnedControl: ObjectRef, environment: string, source: VerificationSnapshotSource,
  budgetMs = 30 * 60 * 1000,
) {
  const deadline = Date.now() + budgetMs;
  if (!Number.isInteger(budgetMs) || budgetMs <= 0 || budgetMs > 30 * 60 * 1000) throw new ArchiveFailure('incomplete');
  try {
    const archive = await withinDeadline(() => readPreservedArchive(store, pinnedControl, environment, Math.min(budgetMs, 40_000)), deadline);
    if (Date.now() >= deadline) throw new ArchiveFailure('incomplete');
    const latest = Date.parse(archive.latestComplete);
    if (!Number.isFinite(latest) || latest > Date.now()) throw new ArchiveFailure('mismatch');
    if (Date.now() - latest > 26 * 60 * 60 * 1000) throw new ArchiveFailure('incomplete');
    const legacy = await withinDeadline(() => readLegacyClassification(store, archive.baselineRef, environment, archive.cutoverId, archive.v1Count, archive.v1Digest, deadline), deadline);
    const run = z.uuid().safeParse(await withinDeadline(() => source.begin(), deadline));
    requireCondition(run.success);
    const { snapshot:scanned, pages } = await readSnapshotPages(cursor => withinDeadline(() => source.page(run.data, cursor), deadline), deadline);
    const comparison = comparePreservation(scanned, archive);
    compareLegacyStructure(scanned.legacyFindings, legacy.findings, scanned.legacyIdentities);
    if (Date.now() >= deadline) throw new ArchiveFailure('incomplete');
    return { status: 'evidence_only' as const, pages, v1Count: comparison.v1Count,
      archivedRows: comparison.archivedRows, newerRows: comparison.newerRows,
      historicalVerdict: legacy.historicalVerdict, legacyAnomalies: legacy.anomalyCount,
      legacyRecomputationAvailable: legacy.recomputationAvailable };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    throw new ArchiveFailure('unavailable');
  }
}
