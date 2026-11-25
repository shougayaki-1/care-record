import { describe, expect, it } from 'vitest';
import { sha256, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { writeFailureReceipt } from './receipt';
class MemoryStore implements Store {
  objects=new Map<string,{ref:ObjectRef;bytes:Buffer}>();
  async list() {return {names:[]};}
  async read(name:string,generation?:string) { const value=this.objects.get(name); return value && (!generation || generation===value.ref.generation) ? value : null; }
  async create(name:string,bytes:Buffer) {
    if (!this.objects.has(name)) this.objects.set(name,{ref:{name,generation:'9007199254740993',size:String(bytes.length),digest:sha256(bytes)},bytes});
    return this.objects.get(name)!;
  }
}
const input={environment:'staging',runId:'123456789',attempt:'1',createdAt:'2026-01-01T00:00:00Z',category:'mismatch'};
describe('failure receipt', () => {
  it('writes and reads back a fixed non-sensitive result, and retries identical bytes', async () => {
    const store=new MemoryStore(); const ref=await writeFailureReceipt(store,input);
    expect(await writeFailureReceipt(store,input)).toEqual(ref);
    expect(JSON.parse((await store.read(ref.name))!.bytes.toString())).toEqual({schema:'audit-verification-result:1',environment:'staging',runId:'123456789',attempt:'1',runUrl:'https://github.com/shougayaki-1/care-record/actions/runs/123456789',verifierVersion:'audit-verifier:1',createdAt:input.createdAt,status:'mismatch'});
  });
  it('rejects success, unknown details, unsafe paths and conflicting retries', async () => {
    const store=new MemoryStore();
    await expect(writeFailureReceipt(store,{...input,category:'success'})).rejects.toThrow();
    await expect(writeFailureReceipt(store,{...input,details:'private'})).rejects.toThrow();
    await expect(writeFailureReceipt(store,{...input,runId:'../bad'})).rejects.toThrow();
    await expect(writeFailureReceipt(store,{...input,runId:'9'.repeat(21)})).rejects.toThrow();
    await writeFailureReceipt(store,input);
    await expect(writeFailureReceipt(store,{...input,category:'incomplete'})).rejects.toThrow();
    expect((await writeFailureReceipt(store,{...input,attempt:'2',category:'incomplete'})).name).not.toBe((await writeFailureReceipt(store,input)).name);
  });
  it('fails closed if the receipt cannot be read back', async () => {
    const store=new MemoryStore(); store.read=async () => null;
    await expect(writeFailureReceipt(store,input)).rejects.toThrow();
  });
});
