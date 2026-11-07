'use server';

import { z } from 'zod';
import { getAuthedUser, createSessionClient } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
import { trySyncSilently } from './shifts/googleSyncInternal';

const id = z.string().uuid();
const dateTime = z.string().refine(value => Number.isFinite(Date.parse(value)));
const staff = z.object({ staff_id: id, staff_role_id: id.nullable().optional() });
const beforeSegment = z.object({
  id, start_at: dateTime, end_at: dateTime, sort_order: z.number(),
  service_type_id: id.nullable(), source_pattern_segment_id: id.nullable(), staffs: z.array(staff),
});
const proposedSegment = z.object({
  start_at: dateTime, end_at: dateTime, service_type_id: id.nullable().optional(), staffs: z.array(staff),
});
const named = z.object({ id, name: z.string().nullable() });
const proposalSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmation_required'), proposal_id: id, expires_at: dateTime,
    before: z.object({ id, title: z.string().nullable(), start_at: dateTime, end_at: dateTime,
      staffs: z.array(z.object({ staff_id: id })), segments: z.array(beforeSegment) }),
    proposal: z.object({ start_at: dateTime, end_at: dateTime, segments: z.array(proposedSegment) }),
    references: z.object({ organization: named, client: named, staffs: z.array(named), staff_roles: z.array(named), service_types: z.array(named) }),
  }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('changed') }),
  z.object({ status: z.literal('updated'), shift_id: id, google_sync_status: z.string().nullable() }),
]);

export async function getMcpShiftUpdateReview(proposalId: string) {
  return withActionResult('getMcpShiftUpdateReview', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_shift_update_proposal', { p_proposal_id: proposalId });
    if (error) throw sanitizeDbError(error, 'mcp.shift-update.review');
    if (!data) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    return proposalSchema.parse(data);
  });
}

const confirmationSchema = z.object({ status: z.literal('updated'), shift_id: id, organization_id: id,
  google_sync_status: z.string().nullable(), newly_updated: z.boolean() });

export async function confirmMcpShiftUpdate(proposalId: string) {
  return withActionResult('confirmMcpShiftUpdate', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('VALIDATION_ERROR', '確認する案が不正です');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('confirm_mcp_shift_update', { p_proposal_id: proposalId });
    if (error?.code === '23505' && error.message === 'shift_conflict') throw new ExpectedActionError('VERSION_CONFLICT', '利用者または担当スタッフの予定が重複しています。新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'proposal_expired') throw new ExpectedActionError('VALIDATION_ERROR', '確認期限が切れました。新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'proposal_changed') throw new ExpectedActionError('VERSION_CONFLICT', '対象が変更されました。新しい案を作成してください');
    if (error) throw sanitizeDbError(error, 'mcp.shift-update.confirm');
    const result = confirmationSchema.parse(data);
    if (result.newly_updated) {
      // The DB update and audit are committed; external sync failure stays pending.
      try { await trySyncSilently(result.organization_id, result.shift_id, 'sync'); } catch { /* status remains available for repair */ }
    }
    const { data: shift, error: readError } = await session.from('shifts').select('google_sync_status').eq('id', result.shift_id).maybeSingle();
    return { shiftId: result.shift_id, googleSyncStatus: readError ? null : shift?.google_sync_status ?? result.google_sync_status };
  });
}
