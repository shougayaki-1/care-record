'use server';

import { z } from 'zod';
import { getAuthedUser, createSessionClient } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
import { trySyncSilently } from './shifts/googleSyncInternal';

const proposalSchema = z.object({
  proposal_id: z.string().uuid(), organization_name: z.string(), client_name: z.string(), staff_name: z.string(),
  start_at: z.string(), end_at: z.string(), expires_at: z.string(),
  status: z.enum(['confirmation_required', 'created', 'expired']), shift_id: z.string().uuid().nullable(),
});
const resultSchema = z.object({ status: z.literal('created'), shift_id: z.string().uuid(), organization_id: z.string().uuid(), google_sync_status: z.string().nullable(), newly_created: z.boolean() });

export async function getMcpShiftCreateProposal(id: string) {
  return withActionResult('getMcpShiftCreateProposal', async () => {
    await getAuthedUser();
    if (!z.string().uuid().safeParse(id).success) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_shift_create_proposal', { p_proposal_id: id });
    if (error) throw sanitizeDbError(error, 'mcp.shift-create.proposal');
    if (!data) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    return proposalSchema.parse(data);
  });
}

export async function confirmMcpShiftCreate(id: string) {
  return withActionResult('confirmMcpShiftCreate', async () => {
    await getAuthedUser();
    if (!z.string().uuid().safeParse(id).success) throw new ExpectedActionError('VALIDATION_ERROR', '確認する案が不正です');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('confirm_mcp_shift_create', { p_proposal_id: id });
    if (error?.code === '23505' && error.message === 'shift_conflict') throw new ExpectedActionError('VERSION_CONFLICT', '利用者または担当スタッフの予定が重複しています。内容を確認して新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'proposal_expired') throw new ExpectedActionError('VALIDATION_ERROR', '確認期限が切れました。新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'proposal_changed') throw new ExpectedActionError('VERSION_CONFLICT', '利用者または担当スタッフの情報が変更されました。新しい案を作成してください');
    if (error) throw sanitizeDbError(error, 'mcp.shift-create.confirm');
    const result = resultSchema.parse(data);
    if (result.newly_created) {
      // The DB transaction has committed; an external failure must not turn it into an apparent failure.
      try { await trySyncSilently(result.organization_id, result.shift_id, 'sync'); } catch { /* pending state remains available for repair */ }
    }
    const { data: shift, error: readError } = await session.from('shifts').select('google_sync_status').eq('id', result.shift_id).maybeSingle();
    return { shiftId: result.shift_id, googleSyncStatus: readError ? null : shift?.google_sync_status ?? result.google_sync_status };
  });
}
