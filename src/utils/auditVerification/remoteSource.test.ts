import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteVerificationSource } from './remoteSource';
import { verificationControlDigest } from './controlContext';

const mocks=vi.hoisted(() => ({config:vi.fn(),store:vi.fn(),control:vi.fn(),source:vi.fn(),begin:vi.fn(),page:vi.fn(),recompute:vi.fn()}));
vi.mock('@/utils/auditArchive/config',() => ({archiveConfig:mocks.config}));
vi.mock('@/utils/auditArchive/gcs',() => ({createArchiveStore:mocks.store}));
vi.mock('@/utils/auditArchive/publisher',() => ({loadControl:mocks.control}));
vi.mock('@/utils/auditVerification/source',() => ({createVerificationSource:mocks.source}));
import { POST } from '@/app/api/cron/verify-audit/route';

const run='15200000-0000-4000-8000-000000000001',row='15200000-0000-4000-8000-000000000002';
const requestId='15200000-0000-4000-8000-000000000003';
const pinned = {name:'control/staging/root.json',generation:'1',digest:'b'.repeat(64),size:'10'};
const controlContext = verificationControlDigest('staging',pinned);
const safeHeaders={'cache-control':'private, no-store, max-age=0','content-type':'application/json'};
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('CRON_SECRET','test-only'); vi.stubEnv('AUDIT_VERIFICATION_API_ENABLED','true');
  mocks.config.mockReturnValue({environment:'staging',mode:'v2',bucket:'test',pinned:{name:'control/staging/root.json',generation:'1',digest:'b'.repeat(64),size:'10'}});
  mocks.control.mockResolvedValue({baselineFinalized:true,baseline:{}});
  mocks.source.mockReturnValue({begin:mocks.begin,page:mocks.page,recompute:mocks.recompute});
  mocks.begin.mockResolvedValue(run); mocks.page.mockResolvedValue({items:[],cursor:null,more:false});
  mocks.recompute.mockResolvedValue([{id:row,hash:'a'.repeat(64)}]);
});
describe('remote audit verification source', () => {
  it('connects the worker to the route with a fixed origin, private responses and no redirects', async () => {
    const request=vi.fn(async (url:URL,init:RequestInit) => POST(new NextRequest(url,init as ConstructorParameters<typeof NextRequest>[1])));
    const source=createRemoteVerificationSource('https://example.test','staging','test-only',requestId,request);
    expect(await source.begin(undefined,pinned)).toBe(run);
    expect(await source.begin(undefined,pinned)).toBe(run);
    expect(JSON.parse(request.mock.calls[0][1].body as string)).toEqual({operation:'begin',requestId,controlContext});
    expect(JSON.parse(request.mock.calls[1][1].body as string)).toEqual({operation:'begin',requestId,controlContext});
    expect(await source.page(run,null)).toEqual({items:[],cursor:null,more:false});
    expect(await source.recompute!(run,[row],'UTC','ISO, MDY')).toEqual([{id:row,hash:'a'.repeat(64)}]);
    expect(request).toHaveBeenCalledTimes(4);
    for (const [url,init] of request.mock.calls) {
      expect(url.toString()).toBe('https://example.test/api/cron/verify-audit');
      expect(init.redirect).toBe('error'); expect(init.cache).toBe('no-store');
      expect((init.headers as Record<string,string>).authorization).toBe('Bearer test-only');
    }
  });
  it('rejects untrusted origin shapes before sending the secret', () => {
    const request=vi.fn();
    for (const origin of ['http://example.test','https://user:pass@example.test','https://example.test/path','https://example.test?x=1','https://example.test/#x']) {
      expect(() => createRemoteVerificationSource(origin,'staging','test-only',requestId,request)).toThrow();
    }
    expect(() => createRemoteVerificationSource('https://example.test','staging','bad\nsecret',requestId,request)).toThrow();
    expect(() => createRemoteVerificationSource('https://example.test','staging','test-only','invalid-id',request)).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects an absent or cross-environment inspection pin before sending a request', async () => {
    const request=vi.fn();
    const source=createRemoteVerificationSource('https://example.test','staging','test-only',requestId,request);
    await expect(source.begin()).rejects.toMatchObject({category:'mismatch'});
    await expect(source.begin(undefined,{...pinned,name:'control/production/root.json'})).rejects.toMatchObject({category:'mismatch'});
    expect(request).not.toHaveBeenCalled();
  });
  it('refuses redirects, missing cache protection and oversized responses', async () => {
    const reply=vi.fn(); const source=createRemoteVerificationSource('https://example.test','staging','test-only',requestId,reply);
    reply.mockResolvedValueOnce(new Response('',{status:302,headers:{location:'https://other.test',...safeHeaders}}));
    await expect(source.begin(undefined,pinned)).rejects.toMatchObject({category:'unavailable'});
    reply.mockResolvedValueOnce(new Response('{}',{status:200}));
    await expect(source.begin(undefined,pinned)).rejects.toMatchObject({category:'unavailable'});
    reply.mockResolvedValueOnce(new Response('{}',{status:200,headers:{'cache-control':'not-private, no-store-ish'}}));
    await expect(source.begin(undefined,pinned)).rejects.toMatchObject({category:'unavailable'});
    reply.mockResolvedValueOnce(new Response('x'.repeat(1024*1024+1),{status:200,headers:safeHeaders}));
    await expect(source.begin(undefined,pinned)).rejects.toMatchObject({category:'unavailable'});
  });
  it('propagates the worker deadline abort to the HTTP request', async () => {
    const request = vi.fn((_url:URL,init:RequestInit) => new Promise<Response>((_,reject) => {
      init.signal!.addEventListener('abort',() => reject(new Error('aborted')));
    }));
    const source=createRemoteVerificationSource('https://example.test','staging','test-only',requestId,request);
    const controller=new AbortController();
    const pending=source.begin(controller.signal,pinned);
    controller.abort();
    await expect(pending).rejects.toMatchObject({category:'unavailable'});
    expect(request).toHaveBeenCalledOnce();
  });
  it('rejects malformed or mismatched data and suppresses raw transport errors', async () => {
    const reply=vi.fn(); const source=createRemoteVerificationSource('https://example.test','staging','test-only',requestId,reply);
    reply.mockRejectedValueOnce(new Error('secret details'));
    await expect(source.begin(undefined,pinned)).rejects.toMatchObject({category:'unavailable',message:'unavailable'});
    reply.mockResolvedValueOnce(new Response('{',{status:200,headers:safeHeaders}));
    await expect(source.begin(undefined,pinned)).rejects.toMatchObject({category:'mismatch'});
    reply.mockResolvedValueOnce(new Response(JSON.stringify({rows:[{id:run,hash:'a'.repeat(64)}]}),{status:200,headers:safeHeaders}));
    await expect(source.recompute!(run,[row],'UTC','ISO, MDY')).rejects.toMatchObject({category:'mismatch'});
    reply.mockResolvedValueOnce(new Response('{"status":"incomplete"}',{status:503,headers:safeHeaders}));
    await expect(source.begin(undefined,pinned)).rejects.toMatchObject({category:'incomplete'});
  });
});
