import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveFailure, sha256, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
const mocks=vi.hoisted(() => ({inspect:vi.fn()}));
vi.mock('./inspect',() => ({inspectPreservation:mocks.inspect}));
import { runVerification } from './run';

class MemoryStore implements Store {
  objects=new Map<string,{ref:ObjectRef;bytes:Buffer}>();
  async list() { return {names:[]}; }
  async read(name:string,generation?:string) { const item=this.objects.get(name); return item && (!generation || item.ref.generation===generation) ? item : null; }
  async create(name:string,bytes:Buffer) {
    if (!this.objects.has(name)) this.objects.set(name,{ref:{name,generation:'9007199254740993',size:String(bytes.length),digest:sha256(bytes)},bytes});
    return this.objects.get(name)!;
  }
}
const metadata={environment:'staging',runId:'123456789',attempt:'1',createdAt:'2026-01-01T00:00:00Z'};
const pin={name:'control/staging/root.json',generation:'1',size:'1',digest:'a'.repeat(64)};
const cutover='15200000-0000-4000-8000-000000000004';
const targetManifest={name:`archive/staging/${cutover}/manifests/1.json`,generation:'9007199254740993',size:'10',digest:'b'.repeat(64)};
const evidence={status:'evidence_only',cutoverId:cutover,targetOrdinal:'1',targetManifest};
const source={begin:async()=>{throw new Error('not used');},page:async()=>null};
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
describe('verification non-success orchestration', () => {
  it('records evidence-only as incomplete and retries identical bytes', async () => {
    mocks.inspect.mockResolvedValue({...evidence,privateDetail:'must-not-escape'});
    const archive=new MemoryStore(), receipts=new MemoryStore();
    const first=await runVerification(metadata,archive,receipts,pin,source);
    expect(first.status).toBe('incomplete');
    const content=(await receipts.read(first.receipt.name))!.bytes.toString();
    expect(content).not.toContain('must-not-escape');
    expect(JSON.parse(content)).toMatchObject({environment:'staging',runId:'123456789',status:'incomplete',target:{cutoverId:cutover,ordinal:'1',ref:targetManifest}});
    expect(await runVerification(metadata,archive,receipts,pin,source)).toEqual(first);
    expect(mocks.inspect.mock.calls[0][4]).toBe(30*60*1000-60_000);
  });
  it('preserves fixed failure categories and masks unexpected errors', async () => {
    for (const [error,status] of [[new ArchiveFailure('mismatch'),'mismatch'],[new ArchiveFailure('incomplete'),'incomplete'],
      [new ArchiveFailure('not_configured'),'unavailable'],[new Error('private secret'),'unavailable']] as const) {
      mocks.inspect.mockRejectedValueOnce(error);
      const receipts=new MemoryStore();
      const result=await runVerification(metadata,new MemoryStore(),receipts,pin,source);
      expect(result.status).toBe(status);
      expect((await receipts.read(result.receipt.name))!.bytes.toString()).not.toContain('private secret');
    }
  });
  it('records the pinned target when a later integrity check fails', async () => {
    mocks.inspect.mockImplementationOnce(async (...args:unknown[]) => {
      const onTarget=args[7] as (value:unknown) => void;
      onTarget({cutoverId:cutover,ordinal:'1',ref:targetManifest});
      throw new ArchiveFailure('mismatch');
    });
    const receipts=new MemoryStore();
    const result=await runVerification(metadata,new MemoryStore(),receipts,pin,source);
    expect(result.status).toBe('mismatch');
    expect(JSON.parse((await receipts.read(result.receipt.name))!.bytes.toString())).toMatchObject({status:'mismatch',target:{cutoverId:cutover,ordinal:'1',ref:targetManifest}});
  });
  it('reserves time to write an incomplete receipt when inspection stalls', async () => {
    vi.useFakeTimers();
    mocks.inspect.mockImplementation(() => new Promise(() => {}));
    const receipts=new MemoryStore();
    const pending=runVerification(metadata,new MemoryStore(),receipts,pin,source,undefined,1000);
    await vi.advanceTimersByTimeAsync(501);
    const result=await pending;
    expect(result.status).toBe('incomplete');
    expect(JSON.parse((await receipts.read(result.receipt.name))!.bytes.toString()).status).toBe('incomplete');
  });
  it('never returns a result if receipt creation or readback fails', async () => {
    mocks.inspect.mockResolvedValue(evidence);
    const receipts=new MemoryStore(); receipts.create=async()=>{throw new Error('private storage detail');};
    await expect(runVerification(metadata,new MemoryStore(),receipts,pin,source)).rejects.toMatchObject({category:'unavailable'});
    const unreadable=new MemoryStore(); unreadable.read=async()=>null;
    await expect(runVerification(metadata,new MemoryStore(),unreadable,pin,source)).rejects.toThrow();
  });
  it('rejects invalid metadata before reading archives or starting snapshots', async () => {
    await expect(runVerification({...metadata,runId:'../bad'},new MemoryStore(),new MemoryStore(),pin,source)).rejects.toThrow();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
});
