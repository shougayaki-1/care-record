'use server';

import { z } from 'zod';
import { getAuthedUser, createSessionClient } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';

const id = z.string().uuid();
const values = z.object({ name: z.string().min(1).max(100), employment_type: z.string().nullable().optional(), work_style: z.string().nullable().optional() });
const reviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmation_required'), proposal_id: id, target_id: id, kind: z.enum(['client', 'staff']),
    organization_name: z.string().min(1), before: values, proposal: values, expires_at: z.string().refine(value => Number.isFinite(Date.parse(value))) }),
  z.object({ status: z.literal('updated') }), z.object({ status: z.literal('expired') }), z.object({ status: z.literal('changed') }),
]);

export async function getMcpMasterEditReview(proposalId: string) {
  return withActionResult('getMcpMasterEditReview', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_master_edit_review', { p_proposal: proposalId });
    if (error) throw sanitizeDbError(error, 'mcp.master-edit.review');
    if (!data) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    return reviewSchema.parse(data);
  });
}

export async function confirmMcpMasterEdit(proposalId: string) {
  return withActionResult('confirmMcpMasterEdit', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('VALIDATION_ERROR', '確認する案が不正です');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('confirm_mcp_master_edit', { p_proposal: proposalId });
    if (error?.code === '22023' && error.message === 'proposal_expired') throw new ExpectedActionError('VALIDATION_ERROR', '確認期限が切れました。新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'proposal_changed') throw new ExpectedActionError('VERSION_CONFLICT', '対象が変更されました。新しい案を作成してください');
    if (error) throw sanitizeDbError(error, 'mcp.master-edit.confirm');
    return z.object({ status: z.literal('updated'), newly_updated: z.boolean() }).parse(data);
  });
}
