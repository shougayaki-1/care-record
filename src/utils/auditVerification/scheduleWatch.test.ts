import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => vi.useRealTimers());
import { encode, sha256, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { checkScheduledVerification } from './scheduleWatch';
const day=24*60*60*1000, now=Date.parse('2026-11-26T12:00:00Z');
const baseline={name:'control/staging/baseline.json',generation:'1',size:'1',digest:'b'.repeat(64)};
function control(start:number) {
  const bytes=encode({schema:'audit-control:1',environment:'staging',cutoverId:'15200000-0000-4000-8000-000000000001',
    baselineFinalized:true,baseline,monitoringStartedAt:new Date(start).toISOString()});
  const pin:ObjectRef={name:'control/staging/root.json',generation:'9007199254740993',size:String(bytes.length),digest:sha256(bytes)};
  const store:Store={read:async (name,generation) => name===pin.name && generation===pin.generation ? {bytes,ref:pin} : null,
    list:async () => {throw Error('not used');},create:async () => {throw Error('not used');}};
  return {store,pin,monitoringStartedAt:new Date(start).toISOString()};
}
const run={id:123,run_attempt:1,event:'schedule',head_branch:'main',created_at:new Date(now-day).toISOString()};
const job=(environment:string,conclusion='failure') => ({name:`Audit verification (${environment})`,steps:[{name:'Verify audit preservation',status:'completed',conclusion,started_at:new Date(now-day+1000).toISOString()}]});
const response=(value:unknown) => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
describe('independent schedule observation', () => {
  it('detects no schedule after eight days but never declares verification successful', async () => {
    const {store,pin,monitoringStartedAt}=control(now-9*day); const request=vi.fn(async () => response({total_count:0,workflow_runs:[]}));
    expect(await checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,request,now)).toEqual({schedule:'missing',verification:'incomplete',successEvidenceOverdue:true});
    const [url,init]=request.mock.calls[0] as unknown as [URL,RequestInit];
    expect(url.origin).toBe('https://api.github.com'); expect(url.searchParams.get('event')).toBe('schedule');
    expect(init.redirect).toBe('error'); expect((init.headers as Record<string,string>).authorization).toBe('Bearer token');
  });
  it('allows the initial eight-day grace without calling it a verified success', async () => {
    const {store,pin,monitoringStartedAt}=control(now-2*day);
    expect(await checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,async () => response({total_count:0,workflow_runs:[]}),now))
      .toEqual({schedule:'awaiting',verification:'incomplete',successEvidenceOverdue:false});
  });
  it('uses the separately pinned weekly start rather than the older archive start', async () => {
    const {store,pin}=control(now-90*day);
    const weeklyStart=new Date(now-2*day).toISOString();
    expect(await checkScheduledVerification(store,pin,'staging','token',weeklyStart,async () => response({total_count:0,workflow_runs:[]}),now))
      .toEqual({schedule:'awaiting',verification:'incomplete',successEvidenceOverdue:false});
  });
  it('counts only an actually started scheduled step for the same environment', async () => {
    const {store,pin,monitoringStartedAt}=control(now-9*day);
    const request=vi.fn(async (url:URL) => url.pathname.endsWith('/jobs')
      ? response({total_count:1,jobs:[job('staging')]}) : response({total_count:1,workflow_runs:[run]}));
    expect(await checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,request,now)).toEqual({schedule:'observed',verification:'incomplete',successEvidenceOverdue:true});
    expect(request.mock.calls[1][0].pathname).toContain('/runs/123/attempts/1/jobs');
    const wrong=async (url:URL) => url.pathname.endsWith('/jobs') ? response({total_count:1,jobs:[job('production')]}) : response({total_count:1,workflow_runs:[run]});
    expect((await checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,wrong,now)).schedule).toBe('missing');
  });
  it('checks earlier attempts when a rerun omits the verification job', async () => {
    const {store,pin,monitoringStartedAt}=control(now-9*day);
    const request=vi.fn(async (url:URL) => {
      if (url.pathname.endsWith('/attempts/2/jobs')) return response({total_count:0,jobs:[]});
      if (url.pathname.endsWith('/attempts/1/jobs')) return response({total_count:1,jobs:[job('staging')]});
      return response({total_count:1,workflow_runs:[{...run,run_attempt:2}]});
    });
    expect((await checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,request,now)).schedule).toBe('observed');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not declare a missing schedule when the attempt history exceeds its bound', async () => {
    const {store,pin,monitoringStartedAt}=control(now-9*day);
    const request=async (url:URL) => url.pathname.endsWith('/jobs') ? response({total_count:0,jobs:[]}) : response({total_count:1,workflow_runs:[{...run,run_attempt:11}]});
    await expect(checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,request,now)).rejects.toMatchObject({category:'incomplete'});
  });
  it('rejects manual runs, unstarted steps and incomplete pagination', async () => {
    const {store,pin,monitoringStartedAt}=control(now-9*day);
    await expect(checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,async () => response({total_count:1,workflow_runs:[{...run,event:'workflow_dispatch'}]}),now)).rejects.toMatchObject({category:'mismatch'});
    const skipped=async (url:URL) => url.pathname.endsWith('/jobs') ? response({total_count:1,jobs:[job('staging','skipped')]}) : response({total_count:1,workflow_runs:[run]});
    expect((await checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,skipped,now)).schedule).toBe('missing');
    await expect(checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,async () => response({total_count:101,workflow_runs:[]}),now)).rejects.toMatchObject({category:'incomplete'});
  });
  it('bounds a stalled GitHub response and cancels the body', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const {store,pin,monitoringStartedAt}=control(now-9*day); let cancelled=false;
    const request=async () => new Response(new ReadableStream<Uint8Array>({pull:() => new Promise<void>(() => {}),cancel:() => {cancelled=true;}}));
    const pending=checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,request,now,1000);
    const assertion=expect(pending).rejects.toMatchObject({category:'incomplete'});
    await vi.advanceTimersByTimeAsync(1001); await assertion;
    expect(cancelled).toBe(true);
  });
  it('fails closed on denied API, untrusted control and unsafe token', async () => {
    const {store,pin,monitoringStartedAt}=control(now-9*day);
    await expect(checkScheduledVerification(store,pin,'staging','token',monitoringStartedAt,async () => new Response('',{status:403}),now)).rejects.toMatchObject({category:'unavailable'});
    await expect(checkScheduledVerification(store,{...pin,digest:'c'.repeat(64)},'staging','token',monitoringStartedAt,vi.fn(),now)).rejects.toMatchObject({category:'mismatch'});
    await expect(checkScheduledVerification(store,pin,'staging','bad\ntoken',monitoringStartedAt,vi.fn(),now)).rejects.toMatchObject({category:'not_configured'});
  });
});
