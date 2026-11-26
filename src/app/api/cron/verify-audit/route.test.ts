import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveFailure } from '@/utils/auditArchive/contracts';

const mocks = vi.hoisted(() => ({ config:vi.fn(), store:vi.fn(), control:vi.fn(), createSource:vi.fn(), begin:vi.fn(), page:vi.fn(), recompute:vi.fn() }));
vi.mock('@/utils/auditArchive/config', () => ({ archiveConfig:mocks.config }));
vi.mock('@/utils/auditArchive/gcs', () => ({ createArchiveStore:mocks.store }));
vi.mock('@/utils/auditArchive/publisher', () => ({ loadControl:mocks.control }));
vi.mock('@/utils/auditVerification/source', () => ({ createVerificationSource:mocks.createSource }));
import { POST } from './route';

const run = '15200000-0000-4000-8000-000000000001';
const row = '15200000-0000-4000-8000-000000000002';
const request = (body: string, auth = 'Bearer test-only', environment = 'staging', extra: Record<string,string> = {}) =>
  new NextRequest('https://example.test/api/cron/verify-audit', { method:'POST', body,
    headers: { authorization:auth, 'x-carerecord-environment':environment, ...extra } });
const send = (body: unknown) => request(JSON.stringify(body));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('CRON_SECRET','test-only'); vi.stubEnv('AUDIT_VERIFICATION_API_ENABLED','true');
  mocks.config.mockReturnValue({environment:'staging',mode:'v2',bucket:'test',pinned:{}});
  mocks.control.mockResolvedValue({baselineFinalized:true,baseline:{}});
  mocks.createSource.mockReturnValue({begin:mocks.begin,page:mocks.page,recompute:mocks.recompute});
  mocks.begin.mockResolvedValue(run); mocks.page.mockResolvedValue({items:[],cursor:null,more:false});
  mocks.recompute.mockResolvedValue([{id:row,hash:'a'.repeat(64)}]);
});
describe('audit verification transport', () => {
  it('fails closed for missing or wrong secrets before config, GCS or DB access', async () => {
    for (const auth of ['', 'Bearer wrong']) {
      const response=await POST(request('{"operation":"begin"}',auth));
      expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toContain('private, no-store');
    }
    vi.stubEnv('CRON_SECRET',''); expect((await POST(send({operation:'begin'}))).status).toBe(401);
    expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.createSource).not.toHaveBeenCalled();
  });
  it('is disabled by default and rejects a missing or different environment before DB/GCS access', async () => {
    vi.stubEnv('AUDIT_VERIFICATION_API_ENABLED',''); expect((await POST(send({operation:'begin'}))).status).toBe(503);
    vi.stubEnv('AUDIT_VERIFICATION_API_ENABLED','true');
    expect((await POST(request('{"operation":"begin"}','Bearer test-only','production'))).status).toBe(403);
    expect((await POST(request('{"operation":"begin"}','Bearer test-only',''))).status).toBe(403);
    expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.createSource).not.toHaveBeenCalled();
  });
  it('requires v2 and a pinned finalized control before creating a snapshot', async () => {
    mocks.config.mockReturnValueOnce({environment:'staging',mode:'inventory'});
    expect((await POST(send({operation:'begin'}))).status).toBe(503);
    mocks.control.mockResolvedValueOnce({baselineFinalized:false,baseline:null});
    expect((await POST(send({operation:'begin'}))).status).toBe(503);
    expect(mocks.createSource).not.toHaveBeenCalled();
    const response=await POST(send({operation:'begin'}));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({run});
    expect(mocks.begin).toHaveBeenCalledOnce(); expect(mocks.control).toHaveBeenCalledTimes(2);
  });
  it('accepts bounded page and recomputation requests without a verification success verdict', async () => {
    const page=await POST(send({operation:'page',run,cursor:null}));
    expect(page.status).toBe(200); expect(await page.json()).toEqual({items:[],cursor:null,more:false});
    expect(mocks.page).toHaveBeenCalledWith(run,null); expect(page.headers.get('cache-control')).toContain('private, no-store');
    const response=await POST(send({operation:'recompute',run,ids:[row],timeZone:'UTC',dateStyle:'ISO, MDY'}));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({rows:[{id:row,hash:'a'.repeat(64)}]});
    expect(mocks.recompute).toHaveBeenCalledWith(run,[row],'UTC','ISO, MDY');
  });
  it('rejects malformed, oversized and misleading-length bodies without starting a snapshot', async () => {
    for (const body of ['{', JSON.stringify({operation:'begin',extra:true}), JSON.stringify({operation:'page',run,cursor:['v1','invalid','0',row]}),
      JSON.stringify({operation:'recompute',run,ids:[row,row],timeZone:'UTC',dateStyle:'ISO, MDY'})]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect((await POST(request('x'.repeat(17000),'Bearer test-only','staging',{'content-length':'1'}))).status).toBe(400);
    expect((await POST(request('{}','Bearer test-only','staging',{'content-length':'17000'}))).status).toBe(400);
    expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.createSource).not.toHaveBeenCalled();
  });
  it('rejects invalid DB output and never returns a response larger than the limit', async () => {
    mocks.page.mockResolvedValueOnce({items:null,cursor:null,more:false});
    let response=await POST(send({operation:'page',run,cursor:null}));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({status:'mismatch'});
    mocks.page.mockResolvedValueOnce({items:[{kind:'head',scope:'global',sequence:'1',hash:'x'.repeat(1024*1024),cutoverId:run}],cursor:null,more:false});
    response=await POST(send({operation:'page',run,cursor:null}));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({status:'mismatch'});
    mocks.recompute.mockResolvedValueOnce([{id:run,hash:'a'.repeat(64)}]);
    response=await POST(send({operation:'recompute',run,ids:[row],timeZone:'UTC',dateStyle:'ISO, MDY'}));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({status:'mismatch'});
  });
  it('times out an incomplete request body without starting a snapshot', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({ pull:() => new Promise<void>(() => {}) });
    const request = new NextRequest('https://example.test/api/cron/verify-audit', {
      method:'POST', body:stream, headers:{authorization:'Bearer test-only','x-carerecord-environment':'staging'},
      duplex:'half',
    } as ConstructorParameters<typeof NextRequest>[1]);
    const pending=POST(request);
    await vi.advanceTimersByTimeAsync(15_001);
    expect((await pending).status).toBe(400);
    expect(mocks.createSource).not.toHaveBeenCalled();
  });
  it('classifies a DB request that exceeds the overall deadline as incomplete', async () => {
    vi.useFakeTimers();
    mocks.page.mockImplementationOnce(() => new Promise(() => {}));
    const pending=POST(send({operation:'page',run,cursor:null}));
    await vi.advanceTimersByTimeAsync(25_001);
    const response=await pending;
    expect(response.status).toBe(503); expect(await response.json()).toEqual({status:'incomplete'});
  });
  it('returns only fixed classifications for infrastructure failures', async () => {
    mocks.page.mockRejectedValueOnce(new Error('SECRET sensitive-event-id'));
    let response=await POST(send({operation:'page',run,cursor:null}));
    expect(response.status).toBe(503); expect(await response.text()).toBe('{"status":"unavailable"}');
    mocks.page.mockRejectedValueOnce(new ArchiveFailure('incomplete'));
    response=await POST(send({operation:'page',run,cursor:null}));
    expect(await response.json()).toEqual({status:'incomplete'});
  });
});
