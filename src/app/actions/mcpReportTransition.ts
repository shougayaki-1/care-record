'use server';

import { z } from 'zod';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';

const id = z.string().uuid();
const dateTime = z.string().refine(value => Number.isFinite(Date.parse(value)));
const named = z.object({ id, name: z.string().min(1) });
const result = z.object({ status: z.enum(['approved', 'remanded']), report_id: id, replayed: z.boolean() });
const review = z.union([
  z.object({ status: z.literal('confirmation_required'), proposal_id: id, expires_at: dateTime,
    references: z.object({ organization: named, client: named, report: z.object({ id, service_date: z.string().nullable(),
      start_at: dateTime.nullable(), end_at: dateTime.nullable(), status: z.enum(['pending', 'remanded', 'approved']) }) }),
    transition: z.enum(['approve', 'remand']), reason: z.string().nullable(), expected_version: z.number().int().nonnegative() }),
  result,
  z.object({ status: z.enum(['expired', 'changed']) }),
]);

export async function getMcpReportTransitionReview(proposalId: string) {
  return withActionResult('getMcpReportTransitionReview', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_report_transition_review', { p_proposal: proposalId });
    if (error) throw sanitizeDbError(error, 'mcp.report-transition.review');
    return review.parse(data);
  });
}

export async function confirmMcpReportTransition(proposalId: string) {
  return withActionResult('confirmMcpReportTransition', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('VALIDATION_ERROR', '確認する案が不正です');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('confirm_mcp_report_transition', { p_proposal: proposalId });
    if (error?.code === '22023' && error.message === 'proposal_expired') throw new ExpectedActionError('VALIDATION_ERROR', '確認期限が切れました。新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'proposal_changed') throw new ExpectedActionError('VERSION_CONFLICT', '対象が変更されました。新しい案を作成してください');
    if (error) throw sanitizeDbError(error, 'mcp.report-transition.confirm');
    return result.parse(data);
  });
}

export async function getMcpReportRemandReason(organizationId: string, reportId: string) {
  return withActionResult('getMcpReportRemandReason', async () => {
    await getAuthedUser();
    if (!id.safeParse(organizationId).success || !id.safeParse(reportId).success) throw new ExpectedActionError('VALIDATION_ERROR', '対象の記録が不正です');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_report_remand_reason', { p_org: organizationId, p_report: reportId });
    if (error) throw sanitizeDbError(error, 'mcp.report-transition.reason');
    return z.string().nullable().parse(data);
  });
}
