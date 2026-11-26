import { ArchiveFailure } from '@/utils/auditArchive/contracts';
import { runVerificationWorker } from '@/utils/auditVerification/worker';
import { NotifiedVerificationFailure } from '@/utils/auditVerification/notify';
import { notifyPreflightFailure } from './notify-preflight.mjs';

// Fixed classifications only: never print credentials, API payloads or audit data.
runVerificationWorker().catch(async error => {
  if (!(error instanceof NotifiedVerificationFailure) && process.env.AUDIT_VERIFIER_ENABLED === 'true') {
    try { await notifyPreflightFailure(process.env); }
    catch { console.error('audit_verification_notification_failed'); }
  }
  const category = error instanceof ArchiveFailure && ['mismatch','incomplete','unavailable','not_configured'].includes(error.category)
    ? error.category : 'unavailable';
  console.error(`audit_verification_${category}`);
  process.exitCode = 1;
});
