import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(() => ({storage:vi.fn(),store:vi.fn(),check:vi.fn(),notify:vi.fn()}));
vi.mock('@google-cloud/storage',()=>({Storage:class {constructor(config:unknown){mocks.storage(config);}}}));
vi.mock('@/utils/auditArchive/gcs',()=>({createArchiveStore:mocks.store}));
vi.mock('./scheduleWatch',()=>({checkScheduledVerification:mocks.check}));
vi.mock('./notify',()=>({notifyVerificationFailure:mocks.notify}));
import { notifyScheduleWatch, runScheduleWatch } from './scheduleWatchWorker';

const env={AUDIT_SCHEDULE_WATCH_ENABLED:'true',AUDIT_VERIFICATION_MONITORING_STARTED_AT:'2026-01-01T00:00:00Z',AUDIT_WATCHDOG_GITHUB_TOKEN:'synthetic',APP_ENV:'staging',AUDIT_ARCHIVE_MODE:'v2',
  GCS_AUDIT_BUCKET:'care-record-staging-test-audit-worm',GCP_PROJECT_ID:'project',EXPECTED_GCP_PROJECT_ID:'project',
  AUDIT_CONTROL_OBJECT:'control/staging/root.json',AUDIT_CONTROL_GENERATION:'1',AUDIT_CONTROL_SHA256:'a'.repeat(64),AUDIT_CONTROL_SIZE:'100',
  AUDIT_WATCHDOG_EVIDENCE_URL:'https://github.com/shougayaki-1/care-record/actions/runs/123',DISCORD_ALERT_WEBHOOK_URL:'https://discord.com/api/webhooks/123/token'};
beforeEach(()=>{vi.resetAllMocks();mocks.store.mockReturnValue({read:vi.fn()});mocks.notify.mockResolvedValue(undefined);});
describe('independent schedule watcher',()=>{
  it('denies disabled, static-key and invalid notification configuration before storage access',async()=>{
    for (const change of [{AUDIT_SCHEDULE_WATCH_ENABLED:''},{AUDIT_WATCHDOG_GITHUB_TOKEN:''},{AUDIT_VERIFICATION_MONITORING_STARTED_AT:''},{GOOGLE_APPLICATION_CREDENTIALS:'/key'},
      {GCP_SERVICE_ACCOUNT_KEY_JSON:'key'},{AUDIT_WATCHDOG_EVIDENCE_URL:'https://evil.test/x'},
      {DISCORD_ALERT_WEBHOOK_URL:'https://discord.com.evil.test/api/webhooks/1/token'}]) {
      await expect(runScheduleWatch({...env,...change})).rejects.toThrow();
    }
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it('allows only control reads and reports observed schedules without claiming success',async()=>{
    mocks.check.mockResolvedValue({schedule:'observed',verification:'incomplete',successEvidenceOverdue:false});
    expect(await runScheduleWatch(env)).toEqual({schedule:'observed',verification:'incomplete',successEvidenceOverdue:false});
    expect(mocks.storage).toHaveBeenCalledWith({projectId:'project'});
    const readOnly=mocks.check.mock.calls[0][0];
    await expect(readOnly.create('x',Buffer.from('x'))).rejects.toMatchObject({category:'mismatch'});
    await expect(readOnly.list('x')).rejects.toMatchObject({category:'mismatch'});
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('notifies on a missing schedule and fails if notification cannot be confirmed',async()=>{
    mocks.check.mockResolvedValue({schedule:'missing',verification:'incomplete',successEvidenceOverdue:true});
    await expect(runScheduleWatch(env)).resolves.toEqual({schedule:'missing',verification:'incomplete',successEvidenceOverdue:true});
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({environment:'staging',runId:'123'}),'incomplete',env.DISCORD_ALERT_WEBHOOK_URL);
    mocks.notify.mockRejectedValueOnce(new Error('secret detail'));
    await expect(runScheduleWatch(env)).rejects.toMatchObject({category:'unavailable',message:'unavailable'});
  });
  it('alerts when success evidence is overdue even if a scheduled step ran',async()=>{
    mocks.check.mockResolvedValue({schedule:'observed',verification:'incomplete',successEvidenceOverdue:true});
    await runScheduleWatch(env);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({environment:'staging'}),'incomplete',env.DISCORD_ALERT_WEBHOOK_URL);
  });
  it('rejects invalid run links without sending notifications',async()=>{
    await expect(notifyScheduleWatch({...env,AUDIT_WATCHDOG_EVIDENCE_URL:'https://github.com/other/repo/actions/runs/1'},'unavailable')).rejects.toMatchObject({category:'unavailable'});
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
