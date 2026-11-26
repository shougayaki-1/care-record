import { z } from 'zod';
import { ArchiveFailure, type ObjectRef, type Store, requireCondition } from '@/utils/auditArchive/contracts';
import { loadControl } from '@/utils/auditArchive/publisher';
import { withinDeadline } from './deadline';

const WINDOW = 8 * 24 * 60 * 60 * 1000;
const runSchema = z.object({id:z.number().int().safe().positive(),run_attempt:z.number().int().positive().max(999999),
  event:z.string(),head_branch:z.string().nullable(),created_at:z.string()});
const stepSchema = z.object({name:z.string(),status:z.string(),conclusion:z.string().nullable(),started_at:z.string().nullable()});
const jobSchema = z.object({name:z.string(),steps:z.array(stepSchema).max(100)});
type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

// This proves only that a scheduled environment-specific verification step ran.
// It cannot establish a successful verification or a valid success receipt.
export async function checkScheduledVerification(store: Store, pinned: ObjectRef, environment: 'staging' | 'production',
  token: string, monitoringStartedAt: string, request: Fetch = fetch, now = Date.now(), budgetMs = 30_000) {
  if (!token || /[\r\n]/.test(token) || !Number.isFinite(now) || !Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 30_000)
    throw new ArchiveFailure('not_configured');
  const deadline=Date.now()+budgetMs;
  const control=await withinDeadline(() => loadControl(store,pinned,environment),deadline);
  requireCondition(control.baselineFinalized && control.baseline !== null);
  const start=Date.parse(monitoringStartedAt);
  const archiveStart=Date.parse(control.monitoringStartedAt);
  requireCondition(z.iso.datetime().safeParse(monitoringStartedAt).success && Number.isFinite(start)
    && Number.isFinite(archiveStart) && start>=archiveStart && start<=now);
  const cutoff=Math.max(start,now-WINDOW);
  // No approved success-receipt contract exists yet; fail closed after the
  // monitoring grace period, even when the scheduler itself is running.
  const successEvidenceOverdue=now-start>WINDOW;
  async function read(path: string, params: Record<string,string>) {
    const url=new URL(`https://api.github.com/repos/shougayaki-1/care-record/${path}`);
    for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
    try {
      return await withinDeadline(async signal => {
        const response=await request(url,{headers:{authorization:`Bearer ${token}`,
          accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'},redirect:'error',cache:'no-store',
          signal:AbortSignal.any([signal,AbortSignal.timeout(10_000)])});
        if (!response.ok || response.redirected) throw new ArchiveFailure('unavailable');
        const reader=response.body?.getReader(); if (!reader) throw new ArchiveFailure('unavailable');
        const abort=() => { void reader.cancel().catch(() => {}); };
        signal.addEventListener('abort',abort,{once:true});
        const chunks: Uint8Array[]=[]; let size=0;
        try {
          for (;;) {
            const part=await reader.read();
            if (signal.aborted) throw new ArchiveFailure('incomplete');
            if (part.done) break;
            size+=part.value.byteLength; if (size>1024*1024) throw new ArchiveFailure('incomplete');
            chunks.push(part.value);
          }
          return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as unknown;
        } finally { signal.removeEventListener('abort',abort); void reader.cancel().catch(() => {}); }
      },deadline);
    } catch (error) {
      if (error instanceof ArchiveFailure) throw error;
      throw new ArchiveFailure('unavailable');
    }
  }
  const created=`>=${new Date(cutoff).toISOString().slice(0,10)}`;
  const runs=z.object({total_count:z.number().int().nonnegative(),workflow_runs:z.array(runSchema).max(100)}).safeParse(
    await read('actions/workflows/audit-verification-manual.yml/runs',{event:'schedule',branch:'main',per_page:'100',created}));
  requireCondition(runs.success && runs.data.total_count>=runs.data.workflow_runs.length);
  for (const run of runs.data.workflow_runs) {
    requireCondition(run.event==='schedule' && run.head_branch==='main');
    const createdAt=Date.parse(run.created_at);
    requireCondition(Number.isFinite(createdAt) && createdAt<=now);
    if (createdAt<cutoff) continue;
    const jobs=z.object({total_count:z.number().int().nonnegative(),jobs:z.array(jobSchema).max(100)}).safeParse(
      await read(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,{per_page:'100'}));
    requireCondition(jobs.success && jobs.data.total_count>=jobs.data.jobs.length);
    for (const job of jobs.data.jobs) {
      if (job.name!==`Audit verification (${environment})`) continue;
      const step=job.steps.find(value => value.name==='Verify audit preservation');
      if (!step || !step.started_at || !(step.status==='in_progress' && step.conclusion===null
        || step.status==='completed' && ['success','failure','timed_out','cancelled'].includes(step.conclusion ?? ''))) continue;
      const started=Date.parse(step.started_at);
      requireCondition(Number.isFinite(started) && started>=createdAt && started<=now);
      if (started>=cutoff) return {schedule:'observed' as const,verification:'incomplete' as const,successEvidenceOverdue};
    }
    if (jobs.data.total_count>jobs.data.jobs.length) throw new ArchiveFailure('incomplete');
  }
  if (runs.data.total_count>runs.data.workflow_runs.length) throw new ArchiveFailure('incomplete');
  return {schedule:successEvidenceOverdue ? 'missing' as const : 'awaiting' as const,verification:'incomplete' as const,successEvidenceOverdue};
}
