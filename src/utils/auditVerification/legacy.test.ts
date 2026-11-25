import { describe, expect, it } from 'vitest';
import { encode, sha256, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { readLegacyClassification } from './legacy';

const cutover = '15200000-0000-4000-8000-000000000111';
const prefix = `control/local/${cutover}/`;
class MemoryStore implements Store {
  objects = new Map<string,{ref:ObjectRef;bytes:Buffer}>();
  async list() { return { names:[] }; }
  async read(name:string,generation?:string) { const obj=this.objects.get(name); return obj && (!generation || obj.ref.generation===generation) ? obj : null; }
  async create(name:string,bytes:Buffer) {
    const obj={ref:{name,generation:'9007199254740993',size:String(bytes.length),digest:sha256(bytes)},bytes};
    this.objects.set(name,obj); return obj;
  }
}
async function fixture(store:MemoryStore, countOverride = '1', boundaryAt = '2026-01-01T00:00:00.000000Z') {
  const partBytes=encode({schema:'audit-v1-anomalies:1',historicalVerdict:'unresolved',rows:[{id:'15200000-0000-4000-8000-000000000201',scope:'global',categories:['unreproducible']}]});
  const part=await store.create(`${prefix}anomalies/${sha256(partBytes)}.json`,partBytes);
  const classification=await store.create(`${prefix}classification.json`,encode({schema:'audit-v1-classification:1',historicalVerdict:'unresolved',v1Count:'1',v1Digest:'a'.repeat(64),scopes:[{scope:'global',count:'1'}],counts:{unreproducible:countOverride},anomalyParts:[part.ref],evidenceDigest:'b'.repeat(64),recomputationSettingsEvidence:null}));
  return store.create(`${prefix}baseline.json`,encode({schema:'audit-baseline:1',environment:'local',cutoverId:cutover,v1Count:'1',v1Digest:'a'.repeat(64),historicalVerdict:'unresolved',classification:classification.ref,evidenceDigest:'b'.repeat(64),boundary:{cutoverId:cutover,v1Count:'1',v1Digest:'a'.repeat(64),at:boundaryAt}}));
}

describe('legacy classification evidence', () => {
  it('verifies pinned classification and retains the unresolved historical verdict', async () => {
    const store = new MemoryStore(); const baseline = await fixture(store);
    await expect(readLegacyClassification(store,baseline.ref,'local',cutover,'1','a'.repeat(64),Date.now()+10000)).resolves.toEqual({historicalVerdict:'unresolved',anomalyCount:'1',recomputationAvailable:false});
  });
  it('accepts the PostgreSQL timestamp form accepted by the G operator', async () => {
    const store = new MemoryStore(); const baseline = await fixture(store,'1','2026-01-01 00:00:00.123456+00');
    await expect(readLegacyClassification(store,baseline.ref,'local',cutover,'1','a'.repeat(64),Date.now()+10000)).resolves.toMatchObject({historicalVerdict:'unresolved'});
  });
  it('rejects inconsistent counts, missing parts and mismatched pinned content', async () => {
    const store = new MemoryStore(); const bad = await fixture(store,'2');
    await expect(readLegacyClassification(store,bad.ref,'local',cutover,'1','a'.repeat(64),Date.now()+10000)).rejects.toMatchObject({category:'mismatch'});
    const missing = new MemoryStore(); const baseline = await fixture(missing);
    for (const key of missing.objects.keys()) if (key.includes('/anomalies/')) missing.objects.delete(key);
    await expect(readLegacyClassification(missing,baseline.ref,'local',cutover,'1','a'.repeat(64),Date.now()+10000)).rejects.toThrow();
    const broken = new MemoryStore(); const pinned = await fixture(broken);
    broken.objects.set(pinned.ref.name,{ref:pinned.ref,bytes:Buffer.from('{}')});
    await expect(readLegacyClassification(broken,pinned.ref,'local',cutover,'1','a'.repeat(64),Date.now()+10000)).rejects.toThrow();
  });
  it('reports a stalled object read as incomplete', async () => {
    const store = new MemoryStore(); const baseline = await fixture(store);
    store.read = async () => new Promise(() => {});
    await expect(readLegacyClassification(store,baseline.ref,'local',cutover,'1','a'.repeat(64),Date.now()+30)).rejects.toMatchObject({category:'incomplete'});
  });
});
