'use server';
import { z } from 'zod';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
const id = z.string().uuid();
const dateTime = z.string().refine(value => Number.isFinite(Date.parse(value)));
const named = z.object({ id, name: z.string().min(1) });
const item = z.object({ status: z.literal('confirmation_required'), expires_at: dateTime, expected_version: z.number().int().nonnegative(),
  references: z.object({ organization: named, client: named, report: z.object({ id, service_date: z.string().nullable(), start_at: dateTime.nullable(), end_at: dateTime.nullable(), status: z.enum(['pending','remanded','approved']) }) }),
  transition: z.enum(['approve','remand']), reason: z.string().nullable() });
const finishedItem = z.object({ status: z.enum(['approved','remanded']), report_id: id, replayed: z.boolean() });
const completed = z.object({ status: z.literal('completed'), count: z.number().int().min(1).max(20), items: z.array(finishedItem).min(1).max(20), replayed: z.boolean() }).refine(value => value.items.length === value.count);
const review = z.union([z.object({ status: z.literal('confirmation_required'), batch_id: id, count: z.number().int().min(1).max(20), expires_at: dateTime, items: z.array(item).min(1).max(20) }).refine(value => value.items.length === value.count), completed, z.object({ status: z.enum(['expired','changed']) })]);
export async function getMcpReportTransitionBatchReview(batchId: string) {
  return withActionResult('getMcpReportTransitionBatchReview', async () => {
    await getAuthedUser();
    if (!id.safeParse(batchId).success) throw new ExpectedActionError('NOT_FOUND','確認する案が見つかりません');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_report_transition_batch_review',{ p_batch: batchId });
    if (error) throw sanitizeDbError(error,'mcp.report-transition-batch.review');
    return review.parse(data);
  });
}
export async function confirmMcpReportTransitionBatch(batchId: string) {
  return withActionResult('confirmMcpReportTransitionBatch', async () => {
    await getAuthedUser();
    if (!id.safeParse(batchId).success) throw new ExpectedActionError('VALIDATION_ERROR','確認する案が不正です');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('confirm_mcp_report_transition_batch',{ p_batch: batchId });
    if (error?.code === '22023' && ['proposal_expired','proposal_changed'].includes(error.message)) throw new ExpectedActionError('VERSION_CONFLICT','対象の変更または確認期限切れのため、全件を処理しませんでした。新しい案を作成してください');
    if (error) throw sanitizeDbError(error,'mcp.report-transition-batch.confirm');
    return completed.parse(data);
  });
}
