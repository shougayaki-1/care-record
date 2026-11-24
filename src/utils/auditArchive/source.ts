import 'server-only';
import { serviceRoleForAuditPreservation } from '@/utils/supabase/serviceRole';
import { ArchiveFailure, pageSchema, type Source } from './contracts';

export function createArchiveSource(destination: string): Source {
  const client = serviceRoleForAuditPreservation();
  return {
    async begin(positions, includeV1) {
      const { data, error } = await client.rpc('begin_audit_archive', { p_positions: positions, p_include_v1: includeV1 });
      if (error || !data) throw new ArchiveFailure('unavailable');
      return data;
    },
    async page(run, cursor) {
      const { data, error } = await client.rpc('read_audit_archive', { p_run: run, p_cursor: cursor });
      if (error || !data) throw new ArchiveFailure('unavailable');
      return pageSchema.parse(data);
    },
    async record(status, count) {
      const { error } = await client.from('audit_events').insert({ action_type: 'audit.archive', resource_type: 'audit', outcome: 'success', details: { status, count } });
      if (error) throw new ArchiveFailure('unavailable');
    },
    async cache(ordinal, digest) {
      const { error } = await client.rpc('cache_audit_archive', { p_destination: destination, p_ordinal: ordinal, p_digest: digest });
      if (error) throw new ArchiveFailure('unavailable');
    },
  };
}
