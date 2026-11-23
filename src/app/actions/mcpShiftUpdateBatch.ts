'use server';

import { z } from 'zod';
import { getAuthedUser, createSessionClient } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
import { proposalSchema } from '@/lib/mcpShiftUpdateReviewSchema';
import { trySyncSilently } from './shifts/googleSyncInternal';

const id = z.string().uuid();
const batchSchema = z.object({ batch_id: id, expires_at: z.string(), items: z.array(z.object({
  position: z.number().int(), proposal_id: id, has_overlap: z.boolean(), has_unassigned: z.boolean(), review: proposalSchema,
})).min(1).max(10) });
const resultSchema = z.object({ items: z.array(z.discriminatedUnion('status', [
  z.object({ proposal_id: id, status: z.literal('updated'), result: z.object({ shift_id: id, organization_id: id, newly_updated: z.boolean() }) }),
  z.object({ proposal_id: id, status: z.enum(['shift_conflict', 'proposal_changed', 'proposal_expired']) }),
])) });

export async function getMcpShiftUpdateBatch(batchId: string) {
  return withActionResult('getMcpShiftUpdateBatch', async () => {
    await getAuthedUser();
    if (!id.safeParse(batchId).success) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_shift_update_batch', { p_batch_id: batchId });
    if (error) throw sanitizeDbError(error, 'mcp.shift-batch.review');
    if (!data) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    return batchSchema.parse(data);
  });
}

export async function confirmMcpShiftUpdateBatch(batchId: string, proposalIds: string[]) {
  return withActionResult('confirmMcpShiftUpdateBatch', async () => {
    await getAuthedUser();
    if (!id.safeParse(batchId).success || !z.array(id).min(1).max(10).safeParse(proposalIds).success || new Set(proposalIds).size !== proposalIds.length)
      throw new ExpectedActionError('VALIDATION_ERROR', '確認する案を選択してください');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('confirm_mcp_shift_update_batch', { p_batch_id: batchId, p_proposal_ids: proposalIds });
    if (error) throw sanitizeDbError(error, 'mcp.shift-batch.confirm');
    const parsed = resultSchema.parse(data);
    for (const item of parsed.items) {
      if (item.status === 'updated' && item.result.newly_updated) {
        try { await trySyncSilently(item.result.organization_id, item.result.shift_id, 'sync'); } catch { /* remains pending */ }
      }
    }
    return parsed.items.map(item => ({ proposalId: item.proposal_id, status: item.status }));
  });
}
