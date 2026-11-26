import { ArchiveFailure } from '@/utils/auditArchive/contracts';
import { runVerificationWorker } from '@/utils/auditVerification/worker';

// Fixed classifications only: never print credentials, API payloads or audit data.
runVerificationWorker().catch(error => {
  const category = error instanceof ArchiveFailure && ['mismatch','incomplete','unavailable','not_configured'].includes(error.category)
    ? error.category : 'unavailable';
  console.error(`audit_verification_${category}`);
  process.exitCode = 1;
});
