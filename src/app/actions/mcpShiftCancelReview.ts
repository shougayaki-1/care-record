'use server';

import { z } from 'zod';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
import { trySyncSilently } from './shifts/googleSyncInternal';

const id = z.string().uuid();
const dateTime = z.string().refine(value => Number.isFinite(Date.parse(value)));
const operation = z.enum(['cancel', 'soft_delete']);
const named = z.object({ id, name: z.string().nullable() });
const reviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmation_required'), proposal_id: id, expires_at: dateTime, operation,
    reason: z.string(), before: z.object({ id, title: z.string().nullable(), start_at: dateTime, end_at: dateTime,
      status: z.string().nullable(), linked_report_count: z.number().int().nonnegative() }),
    references: z.object({ organization: named, client: named, staffs: z.array(named) }) }),
  z.object({ status: z.literal('expired') }), z.object({ status: z.literal('changed') }),
  z.object({ status: z.literal('updated'), operation, shift_id: id, google_sync_status: z.string().nullable() }),
]);
const confirmedSchema = z.object({ status: z.literal('updated'), operation, shift_id: id, organization_id: id, newly_updated: z.boolean() });

export async function getMcpShiftCancelReview(proposalId: string) {
  return withActionResult('getMcpShiftCancelReview', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_shift_cancel_proposal', { p_proposal_id: proposalId });
    if (error) throw sanitizeDbError(error, 'mcp.shift-cancel.review');
    if (!data) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    return reviewSchema.parse(data);
  });
}

export async function confirmMcpShiftCancel(proposalId: string) {
  return withActionResult('confirmMcpShiftCancel', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('VALIDATION_ERROR', '確認する案が不正です');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('confirm_mcp_shift_cancel', { p_proposal_id: proposalId });
    if (error?.code === '22023' && error.message === 'proposal_expired') throw new ExpectedActionError('VALIDATION_ERROR', '確認期限が切れました。新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'proposal_changed') throw new ExpectedActionError('VERSION_CONFLICT', '対象が変更されました。新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'retention_policy_required') throw new ExpectedActionError('VALIDATION_ERROR', 'シフトの保持方針が未承認のため削除できません。事業所のオーナーに保持方針の承認を依頼してください。');
    if (error) throw sanitizeDbError(error, 'mcp.shift-cancel.confirm');
    const result = confirmedSchema.parse(data);
    if (result.newly_updated) {
      try { await trySyncSilently(result.organization_id, result.shift_id, result.operation === 'cancel' ? 'sync' : 'delete'); } catch { /* DB change remains committed */ }
    }
    const { data: review, error: readError } = await session.rpc('get_mcp_shift_cancel_proposal', { p_proposal_id: proposalId });
    const parsed = readError ? null : reviewSchema.safeParse(review);
    return { operation: result.operation, googleSyncStatus: parsed?.success && parsed.data.status === 'updated' ? parsed.data.google_sync_status : null };
  });
}
