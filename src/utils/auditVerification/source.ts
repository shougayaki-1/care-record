import 'server-only';
import { serviceRoleForAuditPreservation } from '@/utils/supabase/serviceRole';
import { ArchiveFailure, pageSchema } from '@/utils/auditArchive/contracts';
import type { VerificationSnapshotSource } from './inspect';

export function createVerificationSource(signal?: AbortSignal, request?: { requestId: string; contextDigest: string }): VerificationSnapshotSource {
  const client = serviceRoleForAuditPreservation();
  const requestSignal = (operationSignal?: AbortSignal) => signal && operationSignal
    ? AbortSignal.any([signal, operationSignal]) : signal ?? operationSignal;
  return {
    async begin(operationSignal) {
      if (!request) throw new ArchiveFailure('not_configured');
      const query = client.rpc('begin_audit_verification_request',{p_request_id:request.requestId,p_context_digest:request.contextDigest});
      const abort = requestSignal(operationSignal);
      const {data,error} = await (abort ? query.abortSignal(abort) : query);
      if (error) {
        if (error.code === 'P0001' && ['audit_verification_request_invalid','audit_verification_request_conflict'].includes(error.message)) throw new ArchiveFailure('mismatch');
        throw new ArchiveFailure('unavailable');
      }
      if (!data) throw new ArchiveFailure('unavailable');
      return data;
    },
    async page(run,cursor,operationSignal) {
      const query = client.rpc('read_audit_verification_snapshot',{p_run:run,p_cursor:cursor});
      const abort = requestSignal(operationSignal);
      const {data,error} = await (abort ? query.abortSignal(abort) : query);
      if (error || !data) throw new ArchiveFailure('unavailable');
      const parsed=pageSchema.safeParse(data);
      if (!parsed.success) throw new ArchiveFailure('mismatch');
      return parsed.data;
    },
    async recompute(run,ids,timeZone,dateStyle,operationSignal) {
      const query = client.rpc('recompute_audit_v1_snapshot',{
        p_run:run,p_ids:ids,p_timezone:timeZone,p_datestyle:dateStyle,
      });
      const abort = requestSignal(operationSignal);
      const {data,error} = await (abort ? query.abortSignal(abort) : query);
      if (error) {
        if (error.code === 'P0001' && ['audit_recompute_invalid','audit_recompute_snapshot_mismatch'].includes(error.message)) throw new ArchiveFailure('mismatch');
        throw new ArchiveFailure('unavailable');
      }
      if (!data) throw new ArchiveFailure('unavailable');
      return data;
    },
  };
}
