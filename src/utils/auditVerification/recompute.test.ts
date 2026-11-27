import { describe, expect, it, vi } from 'vitest';
import { encode, sha256, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { recomputeLegacy } from './recompute';
const cutover='15200000-0000-4000-8000-000000000111', run='15200000-0000-4000-8000-000000000112';
const evidence='a'.repeat(64), hash='b'.repeat(64);
class MemoryStore implements Store {
  objects=new Map<string,{ref:ObjectRef;bytes:Buffer}>();
  async list() { return {names:[]}; }
  async read(name:string,generation?:string) { const value=this.objects.get(name); return value&&(!generation||generation===value.ref.generation)?value:null; }
  async create(name:string,bytes:Buffer) { const value={ref:{name,generation:'9007199254740993',size:String(bytes.length),digest:sha256(bytes)},bytes};this.objects.set(name,value);return value; }
}
async function fixture(store:MemoryStore) {return store.create(`control/local/${cutover}/recompute-settings.json`,encode({schema:'audit-v1-recompute-settings:1',environment:'local',cutoverId:cutover,timeZone:'UTC',dateStyle:'ISO, MDY',settingsEvidenceDigest:evidence}));}
function rows(count:number) { return Array.from({length:count},(_,i)=>({id:`15200000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,hash})); }
describe('evidence-backed legacy recomputation', () => {
  it('uses pinned settings, verifies every row and bounds batches to 100',async()=>{
    const store=new MemoryStore(), settings=await fixture(store), data=rows(101);
    const source=vi.fn(async (_run:string,ids:string[],zone:string,style:string)=>{expect(zone).toBe('UTC');expect(style).toBe('ISO, MDY');return ids.map(id=>({id,hash}));});
    await expect(recomputeLegacy(store,settings.ref,'local',cutover,evidence,run,data,new Map(),source,Date.now()+10000)).resolves.toEqual({recomputedRows:'101'});
    expect(source.mock.calls.map(call=>call[1].length)).toEqual([100,1]);
  });
  it('rejects unpinned settings, wrong evidence and missing or reordered rows',async()=>{
    const store=new MemoryStore(), settings=await fixture(store), data=rows(2);
    const source=vi.fn(async()=>[{id:data[1].id,hash},{id:data[0].id,hash}]);
    await expect(recomputeLegacy(store,settings.ref,'local',cutover,'c'.repeat(64),run,data,new Map(),source,Date.now()+10000)).rejects.toThrow();
    expect(source).not.toHaveBeenCalled();
    await expect(recomputeLegacy(store,{...settings.ref,generation:'1'},'local',cutover,evidence,run,data,new Map(),source,Date.now()+10000)).rejects.toThrow();
    await expect(recomputeLegacy(store,settings.ref,'local',cutover,evidence,run,data,new Map(),source,Date.now()+10000)).rejects.toThrow();
  });
  it('matches hash anomalies to the pinned classification without treating them as success',async()=>{
    const store=new MemoryStore(), settings=await fixture(store), data=rows(1), changed='c'.repeat(64);
    const source=async()=>[{id:data[0].id,hash:changed}];
    await expect(recomputeLegacy(store,settings.ref,'local',cutover,evidence,run,data,new Map(),source,Date.now()+10000)).rejects.toThrow();
    const findings=new Map([[data[0].id,{scope:'global',categories:new Set(['hash_mismatch'])}]]);
    await expect(recomputeLegacy(store,settings.ref,'local',cutover,evidence,run,data,findings,source,Date.now()+10000)).resolves.toEqual({recomputedRows:'1'});
  });
});
