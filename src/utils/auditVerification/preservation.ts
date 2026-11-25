import { requireCondition } from '@/utils/auditArchive/contracts';
import type { readPreservedArchive } from '@/utils/auditArchive/publisher';
import type { SnapshotChain } from './snapshot';

type ArchiveEvidence = Awaited<ReturnType<typeof readPreservedArchive>>;

// Compares every externally committed row, including scopes missing entirely
// from the DB. A DB row newer than the archive is explicitly outside this check.
// This is preservation evidence only; v1 historical findings, freshness, all
// pages, result receipt and monitoring remain independent success requirements.
export function comparePreservation(scan: SnapshotChain, archive: ArchiveEvidence) {
  const snapshot = scan.finish();
  requireCondition(snapshot.v1Count === archive.v1Count && snapshot.v1Digest === archive.v1Digest);
  for (const [scope, position] of archive.positions) {
    const head = snapshot.heads.get(scope);
    requireCondition(head && head.cutoverId === archive.cutoverId && BigInt(head.sequence) >= BigInt(position.sequence));
  }
  for (const head of snapshot.heads.values()) requireCondition(head.cutoverId === archive.cutoverId);
  for (const [key, digest] of archive.inventory) requireCondition(snapshot.inventory.get(key) === digest);
  return { archivedRows: archive.inventory.size.toString(), newerRows: (snapshot.inventory.size - archive.inventory.size).toString(),
    v1Count: snapshot.v1Count, archivedThrough: new Map(archive.positions) };
}
