import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObjectRef, Store } from '@/utils/auditArchive/contracts';
const mocks = vi.hoisted(() => ({run: vi.fn()}));
vi.mock('./run', () => ({runVerification: mocks.run}));
import { notifyVerificationFailure, NotifiedVerificationFailure, runVerificationWithNotification } from './notify';

const metadata = {environment:'staging', runId:'12345', attempt:'1', createdAt:'2026-01-01T00:00:00Z'};
const webhook = 'https://discord.com/api/webhooks/123456/test-token';
const store = {} as Store;
const pin = {} as ObjectRef;
const source = {begin: async () => '', page: async () => null};
const receipt = {name:'private',generation:'1',size:'1',digest:'a'.repeat(64)};
const confirmed = () => new Response(JSON.stringify({id:'987654'}), {status:200});
beforeEach(() => vi.resetAllMocks());

describe('verification notification', () => {
  it('sends only a fixed category and run link, with Discord confirmation and mentions disabled', async () => {
    const request = vi.fn(async () => confirmed());
    await notifyVerificationFailure(metadata, 'mismatch', webhook, request);
    const [url, init] = request.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(`${webhook}?wait=true`);
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toEqual({content:'Critical | staging | mismatch | https://github.com/shougayaki-1/care-record/actions/runs/12345',allowed_mentions:{parse:[]}});
  });
  it('rejects non-Discord or modified webhook URLs before sending', async () => {
    const request = vi.fn(async () => confirmed());
    for (const url of ['http://discord.com/api/webhooks/1/token','https://discord.com.evil.test/api/webhooks/1/token',
      'https://discord.com/api/webhooks/1/token?wait=false','https://discord.com/api/webhooks/1/token/extra']) {
      await expect(notifyVerificationFailure(metadata,'incomplete',url,request)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('treats rejected, unconfirmed, invalid and oversized responses as failure without exposing details', async () => {
    const replies = [new Response(null,{status:204}), new Response('private secret',{status:500}),
      new Response('{}',{status:200}), new Response('x'.repeat(65537),{status:200})];
    for (const response of replies) {
      await expect(notifyVerificationFailure(metadata,'unavailable',webhook,async () => response)).rejects.toMatchObject({category:'unavailable',message:'unavailable'});
    }
  });
  it('notifies each non-success and propagates notification failure', async () => {
    mocks.run.mockResolvedValue({status:'incomplete',receipt});
    const request = vi.fn(async () => confirmed());
    await expect(runVerificationWithNotification(metadata,store,store,pin,source,webhook,undefined,1000,request)).rejects.toBeInstanceOf(NotifiedVerificationFailure);
    expect(request).toHaveBeenCalledOnce();
    await expect(runVerificationWithNotification(metadata,store,store,pin,source,webhook,undefined,1000,async () => {throw new Error('secret');})).rejects.toMatchObject({category:'unavailable'});
  });
  it('rejects missing notification configuration before starting verification', async () => {
    await expect(runVerificationWithNotification(metadata,store,store,pin,source,'',undefined,1000)).rejects.toMatchObject({category:'not_configured'});
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('notifies unavailable if verification or receipt creation throws, without leaking errors', async () => {
    mocks.run.mockRejectedValue(new Error('private verification detail'));
    const request = vi.fn(async () => confirmed());
    await expect(runVerificationWithNotification(metadata,store,store,pin,source,webhook,undefined,1000,request)).rejects.toMatchObject({category:'unavailable'});
    expect(JSON.stringify(request.mock.calls)).not.toContain('private verification detail');
    const init = (request.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(JSON.parse(init.body as string).content).toContain('| unavailable |');
  });
});
