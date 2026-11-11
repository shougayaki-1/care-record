'use server';

import { z } from 'zod';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';

const id = z.string().uuid();
const dateTime = z.string().refine(value => Number.isFinite(Date.parse(value)));
const values = z.record(z.string(), z.unknown());
const named = z.object({ id, name: z.string().min(1) });
const recordContent = z.object({ values, start_at: dateTime, end_at: dateTime, actual_service_type_id: id.nullable(),
  actual_staffs: z.array(z.object({ staff_id: id, staff_role_id: id.nullable().optional() })) });
const details = {
  proposal_id: id,
  references: z.object({ organization: named, client: named,
    report: z.object({ id, service_date: z.string().nullable(), start_at: dateTime.nullable(), end_at: dateTime.nullable() }),
    staffs: z.array(named), staff_roles: z.array(named), service_types: z.array(named),
    form_schema: z.array(z.object({ id: z.string(), label: z.string(), type: z.string(), detailLabel: z.string().optional() })).nullable() }),
  before: recordContent.extend({ status: z.enum(['draft', 'approved']) }),
  proposal: recordContent,
  reason: z.string().min(1).max(500),
};
const reviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmation_required'), ...details, expires_at: dateTime, expected_version: z.number().int().nonnegative() }),
  z.object({ status: z.literal('correction_proposed'), ...details, report_id: id, confirmed_at: dateTime, base_version: z.number().int().nonnegative(), base_changed: z.boolean() }),
  z.object({ status: z.literal('updated'), report_id: id, version: z.number().int().nonnegative() }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('changed') }),
]);
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('updated'), report_id: id, version: z.number().int().nonnegative(), replayed: z.boolean() }),
  z.object({ status: z.literal('correction_proposed'), report_id: id, base_version: z.number().int().nonnegative(), replayed: z.boolean() }),
]);

export async function getMcpRecordEditReview(proposalId: string) {
  return withActionResult('getMcpRecordEditReview', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('NOT_FOUND', '確認する案が見つかりません');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_record_edit_review', { p_proposal: proposalId });
    if (error) throw sanitizeDbError(error, 'mcp.record-edit.review');
    return reviewSchema.parse(data);
  });
}

export async function confirmMcpRecordEdit(proposalId: string) {
  return withActionResult('confirmMcpRecordEdit', async () => {
    await getAuthedUser();
    if (!id.safeParse(proposalId).success) throw new ExpectedActionError('VALIDATION_ERROR', '確認する案が不正です');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('confirm_mcp_record_edit', { p_proposal: proposalId });
    if (error?.code === '22023' && error.message === 'proposal_expired') throw new ExpectedActionError('VALIDATION_ERROR', '確認期限が切れました。新しい案を作成してください');
    if (error?.code === '22023' && error.message === 'proposal_changed') throw new ExpectedActionError('VERSION_CONFLICT', '対象が変更されました。新しい案を作成してください');
    if (error) throw sanitizeDbError(error, 'mcp.record-edit.confirm');
    return resultSchema.parse(data);
  });
}

export async function listMcpRecordCorrectionProposals(organizationId: string, offset = 0) {
  return withActionResult('listMcpRecordCorrectionProposals', async () => {
    await getAuthedUser();
    if (!id.safeParse(organizationId).success || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
      throw new ExpectedActionError('VALIDATION_ERROR', '表示条件が不正です');
    }
    const session = await createSessionClient();
    const { data, error } = await session.rpc('list_mcp_record_correction_proposals', { p_org: organizationId, p_limit: 20, p_offset: offset });
    if (error) throw sanitizeDbError(error, 'mcp.record-edit.list');
    return z.object({ proposals: z.array(z.object({ id, report_id: id, client_name: z.string(), confirmed_at: dateTime, base_version: z.number().int().nonnegative() })),
      has_more: z.boolean(), limit: z.number().int(), offset: z.number().int() }).parse(data);
  });
}
