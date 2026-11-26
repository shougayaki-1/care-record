import { ArchiveFailure } from '@/utils/auditArchive/contracts';
import { notifyScheduleWatch, runScheduleWatch } from '@/utils/auditVerification/scheduleWatchWorker';

// Schedule observation does not prove verification success. Never report it as such.
runScheduleWatch().then(result => {
  console.error(`audit_schedule_${result.schedule}`);
  if (result.successEvidenceOverdue) console.error('audit_success_evidence_overdue');
  console.error('audit_verification_incomplete');
  process.exitCode=1;
}).catch(async error => {
  if (process.env.AUDIT_SCHEDULE_WATCH_ENABLED==='true') {
    try { await notifyScheduleWatch(process.env,'unavailable'); }
    catch { console.error('audit_schedule_notification_failed'); }
  }
  const category=error instanceof ArchiveFailure && ['mismatch','incomplete','unavailable','not_configured'].includes(error.category)
    ? error.category : 'unavailable';
  console.error(`audit_schedule_${category}`);
  process.exitCode=1;
});
