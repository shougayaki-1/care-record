'use server';

import { withSafeError } from '@/utils/errors';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertShiftPermission, supabaseAdmin } from '@/utils/supabase/auth';
import { getRetentionPolicy, retentionDeadline } from '@/utils/supabase/retentionPolicy';

import { normalizePatternSegments, uniqueStaffIdsFromSegments } from './helpers';
import { replacePatternStaffs, savePatternSegments, upsertAssignmentsForStaffs } from './internal';
import type { ShiftPatternPayload } from './types';

export async function getShiftPatterns(organizationId: string) {
  return withSafeError('getShiftPatterns', async () => {
      await assertShiftPermission(organizationId, 'view', { requireAllScope: true });
      const { data, error } = await supabaseAdmin.from('shift_patterns').select(`
          id,
          client_id,
          title,
          start_time,
          end_time,
          rrule,
          clients (id, name),
          shift_pattern_staffs (staff_id, staffs (name)),
          shift_pattern_segments (
              id,
              service_type_id,
              start_time,
              end_time,
              sort_order,
              service_type:service_types (id, name),
              shift_pattern_segment_staffs (
                  staff_id,
                  staff_role_id,
                  staff:staffs (id, name),
                  staff_role:staff_roles (id, name, is_unpaid)
              )
          )
      `).eq('organization_id', organizationId).is('deleted_at', null).order('start_time', { ascending: true });
      if (error) throw error;
      return data;
  });
}

export async function createShiftPattern(payload: ShiftPatternPayload) {
  return withSafeError('createShiftPattern', async () => {
      const actor = await assertShiftPermission(payload.organizationId, 'create', { clientId: payload.clientId });
      const segments = normalizePatternSegments(payload);
      const staffIds = uniqueStaffIdsFromSegments(segments);
      const { data: pattern, error } = await supabaseAdmin.from('shift_patterns').insert({
          organization_id: payload.organizationId, client_id: payload.clientId, title: payload.title,
          start_time: payload.startTime, end_time: payload.endTime, rrule: payload.rrule
      }).select('id').single();
      if (error || !pattern) throw error;

      await replacePatternStaffs(pattern.id, staffIds);
      await savePatternSegments(pattern.id, segments);

      // 自動アサイン: ひな形作成時に選択スタッフを assignments に登録（チェックボックス ON 時のみ）
      if (payload.autoAssign && staffIds.length > 0) {
          await upsertAssignmentsForStaffs(payload.organizationId, payload.clientId, staffIds);
      }

      await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift_pattern.create', resourceType: 'shift_pattern', resourceId: pattern.id });
      return { success: true };
  });
}

export async function updateShiftPattern(patternId: string, payload: ShiftPatternPayload) {
  return withSafeError('updateShiftPattern', async () => {
      const { data: existing } = await supabaseAdmin.from('shift_patterns').select('organization_id').eq('id', patternId).single();
      if (!existing?.organization_id) throw new Error('シフトひな形が見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'edit', { patternId, clientId: payload.clientId });
      try {
          const segments = normalizePatternSegments(payload);
          const staffIds = uniqueStaffIdsFromSegments(segments);
          const { error } = await supabaseAdmin.from('shift_patterns').update({
              client_id: payload.clientId,
              title: payload.title,
              start_time: payload.startTime,
              end_time: payload.endTime,
              rrule: payload.rrule,
              updated_at: new Date().toISOString()
          }).eq('id', patternId);
          if (error) throw error;

          await replacePatternStaffs(patternId, staffIds);
          await savePatternSegments(patternId, segments);
          await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift_pattern.update', resourceType: 'shift_pattern', resourceId: patternId });
          return { success: true };
      } catch (error) {
          console.error('Update Shift Pattern Error:', error);
          throw error;
      }
  });
}

export async function deleteShiftPattern(patternId: string) {
  return withSafeError('deleteShiftPattern', async () => {
      const { data: existing } = await supabaseAdmin.from('shift_patterns').select('organization_id').eq('id', patternId).single();
      if (!existing?.organization_id) throw new Error('シフトひな形が見つかりません');
      const actor = await assertShiftPermission(existing.organization_id, 'delete', { patternId });
      const policy = await getRetentionPolicy(actor.organizationId, 'shift');
      const { error } = await supabaseAdmin.from('shift_patterns').update({ deleted_at: new Date().toISOString(),
          deleted_by: actor.userId, retention_until: retentionDeadline(policy.years) }).eq('id', patternId).is('deleted_at', null);
      if (error) throw error;
      await recordAuditEvent({ organizationId: actor.organizationId, actorId: actor.userId, action: 'shift_pattern.soft_delete',
          resourceType: 'shift_pattern', resourceId: patternId, reason: '管理者による削除', details: { legalBasis: policy.legalBasis } });
      return { success: true };
  });
}
