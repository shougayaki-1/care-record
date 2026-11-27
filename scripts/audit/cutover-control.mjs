// Operator-only: no DB credentials, no environment mutation, no automatic enable.
// Dedicated control IAM must enforce create-only independently of this client.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { check, classifyInventory, sha256 } from './cutover-inventory.mjs';
const encode = value => Buffer.from(JSON.stringify(value));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const decimal = /^(0|[1-9][0-9]*)$/;
export async function exact(store, ref) {
  check(ref && typeof ref.name === 'string' && decimal.test(ref.generation)
    && decimal.test(ref.size) && digest.test(ref.digest));
  const saved = await store.read(ref.name,ref.generation);
  check(saved && saved.ref.name === ref.name && saved.ref.generation === ref.generation
    && String(saved.bytes.length) === ref.size && sha256(saved.bytes) === ref.digest);
  return JSON.parse(saved.bytes.toString('utf8'));
}
export async function issueControl(store, plan, recomputation = null) {
  check(plan.schema === 'audit-cutover-plan:1' && ['local','staging','production'].includes(plan.environment)
    && uuid.test(plan.cutoverId) && digest.test(plan.evidenceDigest)
    && plan.boundary?.cutoverId === plan.cutoverId && decimal.test(plan.boundary.v1Count)
    && digest.test(plan.boundary.v1Digest)
    && Number.isFinite(Date.parse(plan.boundary.at)) && Number.isFinite(Date.parse(plan.monitoringStartedAt)));
  for (const gate of ['aDeployment','bDeployment','backupFreshness','oldJobsDrained','legacyExportsReviewed','migrationApplied','approval'])
    check(digest.test(plan.evidence?.[gate]));
  const prefix = `control/${plan.environment}/`;
  check(plan.previousControl.name.startsWith(prefix));
  const previous = await exact(store,plan.previousControl);
  check(previous.schema === 'audit-control:1' && previous.environment === plan.environment
    && previous.cutoverId === 'pre-cutover' && previous.baselineFinalized === false && previous.baseline === null);
  check(Array.isArray(plan.inventoryReceipts) && plan.inventoryReceipts.length > 0);
  const receipts = [];
  let previousDigest = null;
  const archivePrefix = `archive/${plan.environment}/pre-cutover/`;
  for (const [index,ref] of plan.inventoryReceipts.entries()) {
    check(ref.name === `${archivePrefix}manifests/${BigInt(index)+1n}.json`);
    const receipt = await exact(store,ref);
    check(receipt.schema === 'audit-manifest:1' && receipt.environment === plan.environment
      && receipt.cutoverId === 'pre-cutover' && receipt.ordinal === String(index+1)
      && receipt.previousDigest === previousDigest && uuid.test(receipt.run));
    previousDigest=ref.digest; receipts.push(receipt);
  }
  const final = receipts.at(-1), finalRef=plan.inventoryReceipts.at(-1);
  check(final.kind === 'inventory' && final.chunk === null && digest.test(final.v1Digest)
    && decimal.test(final.v1Count));
  const items=[];
  for (const receipt of receipts.filter(value=>value.run === final.run)) {
    if (receipt.kind === 'chunk') {
      check(receipt.chunk?.name === `${archivePrefix}chunks/${receipt.chunk.digest}.json`);
      const chunk = await exact(store,receipt.chunk);
      check(chunk.schema === 'audit-chunk:1' && Array.isArray(chunk.items) && chunk.items.length <= 500);
      items.push(...chunk.items);
    } else check(receipt === final); // one completed inventory for this run
  }
  const classification = classifyInventory(items,recomputation);
  check(classification.v1Count === final.v1Count && classification.v1Digest === final.v1Digest
    && classification.v1Count === plan.boundary.v1Count && classification.v1Digest === plan.boundary.v1Digest);
  // Explicit DB snapshot evidence binds this run to a snapshot AFTER the locked
  // boundary. A pre-cutover run is never relabelled as a finalized baseline.
  check(plan.inventoryRun === final.run && Date.parse(plan.snapshotStartedAt) >= Date.parse(plan.boundary.at)
    && Date.parse(final.createdAt) >= Date.parse(plan.snapshotStartedAt));
  async function create(name, value) {
    const bytes=encode(value);
    check(bytes.length <= 1024*1024);
    const saved=await store.create(name,bytes);
    check(saved.bytes.equals(bytes));
    await exact(store,saved.ref);
    return saved.ref;
  }
  // Shard anomalies so the B object byte bound also holds for large histories.
  const parts=[];
  for (let index=0;index<classification.anomalies.length;index+=500) {
    const body={ schema:'audit-v1-anomalies:1', historicalVerdict:'unresolved', rows:classification.anomalies.slice(index,index+500) };
    parts.push(await create(`${prefix}${plan.cutoverId}/anomalies/${sha256(encode(body))}.json`,body));
  }
  const report={...classification, anomalies:undefined, anomalyParts:parts, evidenceDigest:plan.evidenceDigest};
  const classificationRef=await create(`${prefix}${plan.cutoverId}/classification.json`,report);
  const baseline=await create(`${prefix}${plan.cutoverId}/baseline.json`,{
    schema:'audit-baseline:1',environment:plan.environment,cutoverId:plan.cutoverId,
    v1Count:classification.v1Count,v1Digest:classification.v1Digest,inventoryReceipt:finalRef,
    historicalVerdict:'unresolved',classification:classificationRef,boundary:plan.boundary,
    evidence:plan.evidence,evidenceDigest:plan.evidenceDigest,verifierVersion:'audit-cutover:1',
  });
  const control=await create(`${prefix}${plan.cutoverId}/control.json`,{
    schema:'audit-control:1',environment:plan.environment,cutoverId:plan.cutoverId,
    baselineFinalized:true,baseline,previousControl:plan.previousControl,
    monitoringStartedAt:plan.monitoringStartedAt,
  });
  return { schema:'audit-cutover-pins:1',environment:plan.environment,cutoverId:plan.cutoverId,
    baseline,control,historicalVerdict:'unresolved',enabled:false };
}

// External manifests are the trusted reference. This never updates heads or
// issues another control. A DB ahead of the archive must prove its old anchor.
export function verifyRestoredDatabase(external, database) {
  check(uuid.test(external.cutoverId) && external.cutoverId === database.cutoverId
    && typeof external.ordinal==='string' && decimal.test(external.ordinal) && BigInt(external.ordinal)>0n
    && typeof external.v1Count==='string' && decimal.test(external.v1Count) && digest.test(external.v1Digest)
    && Array.isArray(external.heads) && Array.isArray(database.heads)
    && external.v1Digest === database.v1Digest && external.v1Count === database.v1Count);
  function heads(values) {
    const seen=new Set();
    for(const head of values) {
      check(typeof head.scope==='string' && (head.scope==='global' || (head.scope.startsWith('org:') && uuid.test(head.scope.slice(4))))
        && typeof head.sequence==='string' && decimal.test(head.sequence) && BigInt(head.sequence)>0n
        && digest.test(head.hash) && !seen.has(head.scope));
      seen.add(head.scope);
    }
  }
  heads(external.heads);heads(database.heads);
  for(const head of database.heads)check(head.cutoverId===external.cutoverId);
  for (const anchor of external.heads) {
    const head=database.heads.find(value=>value.scope===anchor.scope);
    check(head && decimal.test(head.sequence) && decimal.test(anchor.sequence)
      && BigInt(head.sequence) >= BigInt(anchor.sequence));
    const hash=head.sequence === anchor.sequence ? head.hash : head.archiveAnchorHash;
    check(hash === anchor.hash && head.cutoverId === external.cutoverId);
  }
  return { status:'consistent',ordinal:external.ordinal,automaticReset:false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , command, planPath, outputPath, settingsPath]=process.argv;
    check(command === 'publish' && planPath && outputPath);
    const plan=JSON.parse(readFileSync(planPath,'utf8'));
    // WIF/ADC of the separately authorized operator; no service-role DB key.
    check(process.env.GCP_PROJECT_ID && process.env.GCP_PROJECT_ID === process.env.EXPECTED_GCP_PROJECT_ID
      && plan.environment === process.env.APP_ENV && process.env.GCS_AUDIT_BUCKET?.includes(`-${plan.environment}-`));
    const { operatorStore }=await import('./cutover-store.mjs');
    const result=await issueControl(await operatorStore(process.env.GCS_AUDIT_BUCKET,plan.environment),plan,
      settingsPath ? JSON.parse(readFileSync(settingsPath,'utf8')) : null);
    // Does not change AUDIT_CONTROL_* or AUDIT_ARCHIVE_MODE. Pin separately after
    // review; a local receipt-file failure can be retried against immutable data.
    writeFileSync(outputPath,JSON.stringify(result),{flag:'wx',mode:0o600});
  } catch { process.stderr.write('audit_cutover_control_failed\n'); process.exitCode=1; }
}
