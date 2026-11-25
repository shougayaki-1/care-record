import 'server-only';
import { serviceRoleForAuditPreservation } from '@/utils/supabase/serviceRole';
import { ArchiveFailure, pageSchema } from '@/utils/auditArchive/contracts';
import type { VerificationSnapshotSource } from './inspect';

export function createVerificationSource(): VerificationSnapshotSource {
  const client = serviceRoleForAuditPreservation();
  return {
    async begin() {
      const {data,error} = await client.rpc('begin_audit_verification_snapshot');
      if (error || !data) throw new ArchiveFailure('unavailable');
      return data;
    },
    async page(run,cursor) {
      const {data,error} = await client.rpc('read_audit_verification_snapshot',{p_run:run,p_cursor:cursor});
      if (error || !data) throw new ArchiveFailure('unavailable');
      const parsed=pageSchema.safeParse(data);
      if (!parsed.success) throw new ArchiveFailure('mismatch');
      return parsed.data;
    },
    async recompute(run,ids,timeZone,dateStyle) {
      const {data,error} = await client.rpc('recompute_audit_v1_snapshot',{
        p_run:run,p_ids:ids,p_timezone:timeZone,p_datestyle:dateStyle,
      });
      if (error) {
        if (error.code === 'P0001' && ['audit_recompute_invalid','audit_recompute_snapshot_mismatch'].includes(error.message)) throw new ArchiveFailure('mismatch');
        throw new ArchiveFailure('unavailable');
      }
      if (!data) throw new ArchiveFailure('unavailable');
      return data;
    },
  };
}
