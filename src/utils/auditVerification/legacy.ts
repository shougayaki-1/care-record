import { z } from 'zod';
import { ArchiveFailure, decimal, digest, refSchema, requireCondition, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { readExactArchiveObject } from '@/utils/auditArchive/publisher';

const categories = new Set(['null','invalid_hash','duplicate_hash','multiple_genesis','branch','cycle','ambiguous_reference','missing_reference','hash_mismatch','unreproducible']);
const scope = z.string().regex(/^(global|org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
const baselineSchema = z.object({ schema:z.literal('audit-baseline:1'), environment:z.enum(['local','staging','production']),
  cutoverId:z.uuid(),v1Count:decimal,v1Digest:digest,historicalVerdict:z.literal('unresolved'),classification:refSchema,evidenceDigest:digest,
  boundary:z.object({cutoverId:z.uuid(),v1Count:decimal,v1Digest:digest,at:z.string().refine(value => Number.isFinite(Date.parse(value)))}) });
const classificationSchema = z.object({ schema:z.literal('audit-v1-classification:1'),historicalVerdict:z.literal('unresolved'),
  v1Count:decimal,v1Digest:digest,scopes:z.array(z.object({scope,count:decimal})),counts:z.record(z.string(),decimal),
  anomalyParts:z.array(refSchema).max(10000),evidenceDigest:digest,recomputationSettingsEvidence:digest.nullable() });
const partSchema = z.object({schema:z.literal('audit-v1-anomalies:1'),historicalVerdict:z.literal('unresolved'),
  rows:z.array(z.object({id:z.uuid(),scope,categories:z.array(z.string()).min(1)})).max(500)});

async function parseObject(store: Store, ref: ObjectRef, deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ArchiveFailure('incomplete');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let object;
  try {
    object = await Promise.race([readExactArchiveObject(store,ref),new Promise<never>((_,reject) => {
      timer = setTimeout(() => reject(new ArchiveFailure('incomplete')),remaining);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(object.bytes)); }
  catch { throw new ArchiveFailure('mismatch'); }
}

// The pinned baseline is preservation evidence, not proof that the period
// before cutover was untampered. Never turn "unresolved" into a success verdict.
export async function readLegacyClassification(
  store: Store, baselineRef: ObjectRef, environment: string, cutoverId: string,
  expectedCount: string, expectedDigest: string, deadline: number,
) {
  if (!Number.isFinite(deadline) || Date.now() >= deadline || deadline - Date.now() > 30 * 60 * 1000) throw new ArchiveFailure('incomplete');
  const prefix = `control/${environment}/${cutoverId}/`;
  requireCondition(baselineRef.name === `${prefix}baseline.json`);
  let baseline: z.infer<typeof baselineSchema>;
  try { baseline = baselineSchema.parse(await parseObject(store,baselineRef,deadline)); }
  catch (error) { if (error instanceof ArchiveFailure) throw error; throw new ArchiveFailure('mismatch'); }
  requireCondition(baseline.environment === environment && baseline.cutoverId === cutoverId
    && baseline.v1Count === expectedCount && baseline.v1Digest === expectedDigest
    && baseline.boundary.cutoverId === cutoverId && baseline.boundary.v1Count === expectedCount
    && baseline.boundary.v1Digest === expectedDigest && baseline.classification.name === `${prefix}classification.json`);
  let report: z.infer<typeof classificationSchema>;
  try { report = classificationSchema.parse(await parseObject(store,baseline.classification,deadline)); }
  catch (error) { if (error instanceof ArchiveFailure) throw error; throw new ArchiveFailure('mismatch'); }
  requireCondition(report.v1Count === expectedCount && report.v1Digest === expectedDigest && report.evidenceDigest === baseline.evidenceDigest);
  const scopeCounts = new Map<string,bigint>();
  for (const item of report.scopes) {
    requireCondition(!scopeCounts.has(item.scope) && BigInt(item.count) > BigInt(0));
    scopeCounts.set(item.scope,BigInt(item.count));
  }
  requireCondition([...scopeCounts.values()].reduce((sum,n) => sum+n,BigInt(0)) === BigInt(expectedCount));
  const ids = new Set<string>(); const findings = new Map<string,{scope:string;categories:Set<string>}>(); const counts = new Map<string,bigint>(); const perScope = new Map<string,bigint>();
  for (const ref of report.anomalyParts) {
    if (Date.now() >= deadline) throw new ArchiveFailure('incomplete');
    requireCondition(ref.name === `${prefix}anomalies/${ref.digest}.json`);
    let part: z.infer<typeof partSchema>;
    try { part = partSchema.parse(await parseObject(store,ref,deadline)); }
    catch (error) { if (error instanceof ArchiveFailure) throw error; throw new ArchiveFailure('mismatch'); }
    requireCondition(part.rows.length > 0);
    for (const row of part.rows) {
      if (ids.size >= 200_000) throw new ArchiveFailure('incomplete');
      requireCondition(!ids.has(row.id) && scopeCounts.has(row.scope)); ids.add(row.id);
      perScope.set(row.scope,(perScope.get(row.scope) ?? BigInt(0))+BigInt(1));
      const unique = new Set(row.categories);
      findings.set(row.id,{scope:row.scope,categories:unique});
      requireCondition(unique.size === row.categories.length && row.categories.every(c => categories.has(c)));
      for (const category of unique) counts.set(category,(counts.get(category) ?? BigInt(0))+BigInt(1));
    }
  }
  if (Date.now() >= deadline) throw new ArchiveFailure('incomplete');
  for (const [key,value] of perScope) requireCondition(value <= scopeCounts.get(key)!);
  requireCondition(Object.keys(report.counts).length === counts.size);
  for (const [key,value] of counts) requireCondition(report.counts[key] === value.toString());
  if (report.recomputationSettingsEvidence === null) {
    requireCondition((counts.get('unreproducible') ?? BigInt(0)) === BigInt(expectedCount) && !counts.has('hash_mismatch'));
  } else requireCondition(!counts.has('unreproducible'));
  return { historicalVerdict:'unresolved' as const, anomalyCount:ids.size.toString(), recomputationAvailable:report.recomputationSettingsEvidence !== null, findings };
}

// Classification metadata is not enough: compare its structural findings to
// an independent traversal of the actual frozen v1 rows. Recomputed-hash and
// unreproducible categories are deliberately left to evidence-backed checks.
export function compareLegacyStructure(
  actual: Map<string,{scope:string;categories:Set<string>}>,
  expected: Map<string,{scope:string;categories:Set<string>}>,
  identities: Map<string,string>,
) {
  for (const [id,row] of actual) {
    const pinned=expected.get(id);
    requireCondition(pinned && pinned.scope === row.scope && [...row.categories].every(c => pinned.categories.has(c)));
  }
  for (const [id,row] of expected) {
    requireCondition(identities.get(id) === row.scope);
    const structural=[...row.categories].filter(c => c !== 'unreproducible' && c !== 'hash_mismatch');
    if (structural.length) {
      const found=actual.get(id);
      requireCondition(found && found.scope === row.scope && structural.every(c => found.categories.has(c)));
    }
  }
}
