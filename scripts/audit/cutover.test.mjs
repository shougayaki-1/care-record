import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { classifyInventory, inventorySummary, readInventory, sha256 } from './cutover-inventory.mjs';
import { issueControl, verifyRestoredDatabase } from './cutover-control.mjs';
const hash=n=>String(n).padStart(64,'0');
function event(previous='GENESIS',current=hash(1),org=null) {
  const id=randomUUID();
  const raw=Buffer.from(JSON.stringify(['audit-inventory:2',id,randomUUID(),org,null,'fixture','test',null,'success',null,null,
    '日本語\n','2026-10-25T01:02:03.123456Z',{value:1},null,null,previous,current,1,null,null,null]));
  return {kind:'v1',id,inventory:raw.toString('base64')};
}
test('fixed v1 inventory keeps NULL/global, microseconds and lossless numeric bytes unresolved',()=>{
  const e=event(null,null);
  e.inventory=Buffer.from(Buffer.from(e.inventory,'base64').toString().replace('"value":1','"value":9007199254740993')).toString('base64');
  const report=classifyInventory([e]);
  assert.equal(report.v1Count,'1');assert.equal(report.scopes[0].scope,'global');
  assert.deepEqual(report.anomalies[0].categories,['null','unreproducible']);
  assert.equal(report.historicalVerdict,'unresolved');
  const changed={...e,inventory:Buffer.from(Buffer.from(e.inventory,'base64').toString().replace('9007199254740993','9007199254740992')).toString('base64')};
  assert.notEqual(report.v1Digest,classifyInventory([changed]).v1Digest);
  assert.throws(()=>classifyInventory([e,e]));
});
test('classifies broken links, branches, multiple GENESIS, duplicate hashes and cycles without repair',()=>{
  const items=[event('GENESIS',hash(1)),event('GENESIS',hash(2)),event(hash(1),hash(3)),event(hash(1),hash(4)),
    event(hash(8),hash(5)),event(hash(7),hash(6)),event(hash(6),hash(7)),event(null,hash(1))];
  const original=structuredClone(items);
  const report=classifyInventory(items);
  for(const category of ['missing_reference','branch','multiple_genesis','cycle','duplicate_hash','ambiguous_reference'])
    assert.ok(BigInt(report.counts[category])>0n,category);
  assert.equal(report.counts.cycle,'2');
  assert.deepEqual(items,original);
});
test('v1 recomputation requires evidence-backed settings and exact inventory coverage',()=>{
  const e=event();
  const settings={schema:'audit-v1-recomputation:1',settingsEvidenceDigest:hash(1),timeZone:'UTC',dateStyle:'ISO, MDY',rows:[{id:e.id,hash:hash(2)}]};
  assert.equal(classifyInventory([e],settings).counts.hash_mismatch,'1');
  assert.throws(()=>classifyInventory([e],{...settings,settingsEvidenceDigest:undefined}));
  assert.throws(()=>classifyInventory([e],{...settings,rows:[]}));
  assert.equal(classifyInventory([e],{...settings,rows:[{id:e.id,hash:hash(1)}]}).historicalVerdict,'unresolved');
});
class Store {
  objects=new Map();generation=9007199254740993n; failAt=null;
  async read(name,generation) {
    const object=this.objects.get(name);
    return object && (!generation || object.ref.generation===generation) ? object : null;
  }
  async create(name,bytes) {
    if(this.failAt && name.endsWith(this.failAt)) throw new Error('interrupted');
    if(!this.objects.has(name))this.objects.set(name,{bytes,ref:{name,generation:String(++this.generation),size:String(bytes.length),digest:sha256(bytes)}});
    return this.objects.get(name);
  }
}
async function fixture() {
  const store=new Store();const cutoverId=randomUUID();const run=randomUUID();
  const items=[event(null,null),event()];const summary=inventorySummary(readInventory(items));
  const previous=await store.create('control/local/preparation.json',Buffer.from(JSON.stringify({schema:'audit-control:1',environment:'local',cutoverId:'pre-cutover',baselineFinalized:false,baseline:null})));
  const chunkBytes=Buffer.from(JSON.stringify({schema:'audit-chunk:1',items}));
  const chunk=await store.create(`archive/local/pre-cutover/chunks/${sha256(chunkBytes)}.json`,chunkBytes);
  const first=await store.create('archive/local/pre-cutover/manifests/1.json',Buffer.from(JSON.stringify({schema:'audit-manifest:1',environment:'local',cutoverId:'pre-cutover',ordinal:'1',previousDigest:null,run,kind:'chunk',chunk:chunk.ref})));
  const final=await store.create('archive/local/pre-cutover/manifests/2.json',Buffer.from(JSON.stringify({schema:'audit-manifest:1',environment:'local',cutoverId:'pre-cutover',ordinal:'2',previousDigest:first.ref.digest,run,kind:'inventory',chunk:null,createdAt:'2026-10-25T01:02:00Z',...summary})));
  return {store,plan:{schema:'audit-cutover-plan:1',environment:'local',cutoverId,evidenceDigest:hash(1),
    evidence:Object.fromEntries(['aDeployment','bDeployment','backupFreshness','oldJobsDrained','legacyExportsReviewed','migrationApplied','approval'].map(k=>[k,hash(2)])),
    boundary:{cutoverId,v1Count:'2',at:'2026-10-25T01:00:00Z'},inventoryRun:run,snapshotStartedAt:'2026-10-25T01:01:00Z',
    monitoringStartedAt:'2026-10-25T01:03:00Z',previousControl:structuredClone(previous.ref),inventoryReceipts:structuredClone([first.ref,final.ref])}};
}
test('operator issues generation-pinned baseline/control, preserves unresolved history and never enables mode',async()=>{
  const {store,plan}=await fixture();const result=await issueControl(store,plan);
  assert.equal(result.enabled,false);assert.equal(result.historicalVerdict,'unresolved');
  assert.ok(BigInt(result.control.generation)>BigInt(Number.MAX_SAFE_INTEGER));
  const baseline=JSON.parse((await store.read(result.baseline.name)).bytes);
  assert.equal(baseline.v1Count,'2');assert.equal(baseline.inventoryReceipt.digest,plan.inventoryReceipts.at(-1).digest);
  const control=JSON.parse((await store.read(result.control.name)).bytes);
  assert.deepEqual(control.previousControl,plan.previousControl);
  assert.deepEqual(await issueControl(store,plan),result);
});
test('interruption before control publication resumes identical objects; conflicts are never overwritten',async()=>{
  const {store,plan}=await fixture();store.failAt='/control.json';
  await assert.rejects(issueControl(store,plan));
  assert.equal([...store.objects.keys()].some(name=>name.endsWith('/control.json')),false);
  store.failAt=null;await issueControl(store,plan);
  await assert.rejects(issueControl(store,{...plan,monitoringStartedAt:'2026-10-25T02:00:00Z'}));
});
test('rejects unapproved dependencies, pre-cutover snapshots, missing/generation-changed/foreign receipts or incomplete v1',async()=>{
  for(const mutate of [p=>{delete p.evidence.bDeployment;},p=>{p.snapshotStartedAt='2026-10-24T00:00:00Z';},
    p=>{p.inventoryReceipts.shift();},p=>{p.previousControl.generation='9007199254740992';},
    p=>{p.inventoryReceipts[0].name='archive/production/pre-cutover/manifests/1.json';},p=>{p.boundary.v1Count='3';}]) {
    const {store,plan}=await fixture();mutate(plan);await assert.rejects(issueControl(store,plan));
    assert.equal([...store.objects.keys()].some(name=>name.endsWith('/control.json')),false);
  }
});
test('restore checks external ordinal and heads before resuming, refuses reset or reused sequence',()=>{
  const id=randomUUID(),head={scope:'global',sequence:'9007199254740993',hash:hash(4),cutoverId:id};
  const external={cutoverId:id,ordinal:'9007199254740995',v1Count:'0',v1Digest:sha256(Buffer.alloc(0)),heads:[head]};
  const db={...external,heads:[head]};assert.equal(verifyRestoredDatabase(external,db).automaticReset,false);
  for(const changed of [{...db,cutoverId:randomUUID()},{...db,v1Digest:hash(9)},
    {...db,heads:[{...head,sequence:'9007199254740992'}]},{...db,heads:[{...head,hash:hash(5)}]}])
    assert.throws(()=>verifyRestoredDatabase(external,changed));
  assert.throws(()=>verifyRestoredDatabase(external,{...db,heads:[{...head,sequence:'9007199254740994'}]}));
  assert.equal(verifyRestoredDatabase(external,{...db,heads:[{...head,sequence:'9007199254740994',archiveAnchorHash:head.hash}]}).status,'consistent');
});
