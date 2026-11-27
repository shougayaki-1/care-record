import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(() => ({rpc:vi.fn()}));
vi.mock('@/utils/supabase/serviceRole',() => ({serviceRoleForAuditPreservation:() => ({rpc:mocks.rpc})}));
import { createVerificationSource } from './source';
const context={requestId:'15200000-0000-4000-8000-000000000003',contextDigest:'b'.repeat(64)};

beforeEach(() => mocks.rpc.mockReset());
describe('verification source', () => {
  it('uses the scoped service-role RPCs with explicit arguments', async () => {
    const source=createVerificationSource(undefined,context);
    mocks.rpc.mockResolvedValueOnce({data:'15200000-0000-4000-8000-000000000001',error:null})
      .mockResolvedValueOnce({data:{items:[],cursor:null,more:false},error:null})
      .mockResolvedValueOnce({data:[{id:'15200000-0000-4000-8000-000000000002',hash:'a'.repeat(64)}],error:null});
    expect(await source.begin()).toBe('15200000-0000-4000-8000-000000000001');
    expect(await source.page('run',null)).toEqual({items:[],cursor:null,more:false});
    expect(await source.recompute!('run',['id'],'UTC','ISO, MDY')).toEqual([{id:'15200000-0000-4000-8000-000000000002',hash:'a'.repeat(64)}]);
    expect(mocks.rpc.mock.calls).toEqual([
      ['begin_audit_verification_request',{p_request_id:context.requestId,p_context_digest:context.contextDigest}],
      ['read_audit_verification_snapshot',{p_run:'run',p_cursor:null}],
      ['recompute_audit_v1_snapshot',{p_run:'run',p_ids:['id'],p_timezone:'UTC',p_datestyle:'ISO, MDY'}],
    ]);
  });
  it('passes the request deadline signal to the RPC transport', async () => {
    const signal = new AbortController().signal;
    const abortSignal = vi.fn()
      .mockResolvedValueOnce({data:'15200000-0000-4000-8000-000000000001',error:null})
      .mockResolvedValueOnce({data:{items:[],cursor:null,more:false},error:null})
      .mockResolvedValueOnce({data:[{id:'15200000-0000-4000-8000-000000000002',hash:'a'.repeat(64)}],error:null});
    mocks.rpc.mockReturnValue({abortSignal});
    const source=createVerificationSource(signal,context);
    expect(await source.begin()).toBe('15200000-0000-4000-8000-000000000001');
    expect(await source.page('run',null)).toEqual({items:[],cursor:null,more:false});
    expect(await source.recompute!('run',['id'],'UTC','ISO, MDY')).toHaveLength(1);
    expect(abortSignal).toHaveBeenCalledTimes(3);
    for (const [received] of abortSignal.mock.calls) expect(received).toBe(signal);
  });
  it('refuses a snapshot without a stable request context', async () => {
    await expect(createVerificationSource().begin()).rejects.toMatchObject({category:'not_configured'});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reports a reused request with changed context as a mismatch', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'P0001',message:'audit_verification_request_conflict'}});
    await expect(createVerificationSource(undefined,context).begin()).rejects.toMatchObject({category:'mismatch'});
  });
  it('classifies malformed data and hides raw database errors', async () => {
    const source=createVerificationSource(undefined,context);
    mocks.rpc.mockResolvedValueOnce({data:{items:null,cursor:null,more:false},error:null})
      .mockResolvedValueOnce({data:null,error:{message:'private detail'}});
    await expect(source.page('run',null)).rejects.toMatchObject({category:'mismatch'});
    const failure=await source.begin().catch(error => error);
    expect(failure).toMatchObject({category:'unavailable',message:'unavailable'});
    expect(String(failure)).not.toContain('private detail');
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'P0001',message:'audit_recompute_snapshot_mismatch'}});
    await expect(source.recompute!('run',['id'],'UTC','ISO, MDY')).rejects.toMatchObject({category:'mismatch',message:'mismatch'});
  });
});
