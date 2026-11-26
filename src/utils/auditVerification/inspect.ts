import { z } from 'zod';
import { ArchiveFailure, requireCondition, type Cursor, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { readCurrentExactArchiveObject, readPreservedArchive } from '@/utils/auditArchive/publisher';
import { readSnapshotPages } from './pages';
import { comparePreservation } from './preservation';
import { compareLegacyStructure, readLegacyClassification } from './legacy';
import { withinDeadline } from './deadline';
import { recomputeLegacy, type RecomputeSource } from './recompute';

export interface VerificationSnapshotSource {
  begin(signal?: AbortSignal): Promise<string>;
  page(run: string, cursor: Cursor, signal?: AbortSignal): Promise<unknown>;
  recompute?: RecomputeSource;
}

// Internal evidence only: never a verification success or a result receipt.
// Historical v1 findings and independent monitoring are not decided here.
export async function inspectPreservation(
  store: Store, pinnedControl: ObjectRef, environment: string, source: VerificationSnapshotSource,
  budgetMs = 30 * 60 * 1000, settingsPin?: ObjectRef, parent?: AbortSignal,
  onTarget?: (target: {cutoverId:string; ordinal:string; ref:ObjectRef}) => void,
) {
  const deadline = Date.now() + budgetMs;
  if (parent?.aborted || !Number.isInteger(budgetMs) || budgetMs <= 0 || budgetMs > 30 * 60 * 1000) throw new ArchiveFailure('incomplete');
  try {
    const archiveBudget = Math.min(budgetMs, 40_000);
    const archiveDeadline = Math.min(deadline, Date.now() + archiveBudget);
    const archive = await withinDeadline(() => readPreservedArchive(store, pinnedControl, environment, archiveBudget), archiveDeadline, parent);
    if (parent?.aborted || Date.now() >= deadline) throw new ArchiveFailure('incomplete');
    onTarget?.({cutoverId:archive.cutoverId,ordinal:archive.ordinal,ref:{...archive.manifestRef}});
    const latest = Date.parse(archive.latestComplete);
    if (!Number.isFinite(latest) || latest > Date.now()) throw new ArchiveFailure('mismatch');
    if (Date.now() - latest > 26 * 60 * 60 * 1000) throw new ArchiveFailure('incomplete');
    const legacy = await withinDeadline(() => readLegacyClassification(store, archive.baselineRef, environment, archive.cutoverId, archive.v1Count, archive.v1Digest, deadline), deadline, parent);
    const run = z.uuid().safeParse(await withinDeadline(signal => source.begin(signal), deadline, parent));
    requireCondition(run.success);
    const { snapshot:scanned, pages } = await readSnapshotPages(cursor => withinDeadline(signal => source.page(run.data, cursor, signal), deadline, parent), deadline);
    const comparison = comparePreservation(scanned, archive);
    compareLegacyStructure(scanned.legacyFindings, legacy.findings, scanned.legacyIdentities);
    let recomputedRows = '0';
    if (legacy.recomputationSettingsEvidence !== null) {
      if (!settingsPin || !source.recompute) throw new ArchiveFailure('incomplete');
      ({ recomputedRows } = await recomputeLegacy(store,settingsPin,environment,archive.cutoverId,
        legacy.recomputationSettingsEvidence,run.data,scanned.legacyRows,legacy.findings,source.recompute,deadline,parent));
    } else if (settingsPin) throw new ArchiveFailure('mismatch');
    if (parent?.aborted || Date.now() >= deadline) throw new ArchiveFailure('incomplete');
    await withinDeadline(() => readCurrentExactArchiveObject(store, archive.manifestRef), deadline, parent);
    if (parent?.aborted || Date.now() >= deadline) throw new ArchiveFailure('incomplete');
    return { status: 'evidence_only' as const, pages, v1Count: comparison.v1Count,
      archivedRows: comparison.archivedRows, newerRows: comparison.newerRows,
      targetManifest: archive.manifestRef, targetOrdinal: archive.ordinal, cutoverId: archive.cutoverId,
      historicalVerdict: legacy.historicalVerdict, legacyAnomalies: legacy.anomalyCount,
      legacyRecomputationAvailable: legacy.recomputationAvailable, recomputedRows };
  } catch (error) {
    if (error instanceof ArchiveFailure) throw error;
    if (error instanceof z.ZodError || error instanceof SyntaxError) throw new ArchiveFailure('mismatch');
    throw new ArchiveFailure('unavailable');
  }
}
