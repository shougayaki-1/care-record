'use server';

import { withActionResult } from '@/utils/errors';

import { sanitizeRpcError } from '@/utils/supabase/rpcErrors';
import type { SaveReportInput } from '@/app/actions/reports';
import { assertOrgPermission, assertOrgRole, assertRecordPermission, createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { asJson } from '@/types/json';
import { ExpectedActionError, sanitizeDbError } from '@/utils/errors';

type ReviewCandidateInput = Pick<SaveReportInput, 'organizationId' | 'clientId' | 'startAt' | 'endAt' | 'values'> & {
  candidateId: string;
  staffId: string;
  travelMethod: 'car' | 'public_transport' | 'other' | 'none';
  travelCostYen: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getMyAiSubmissions(organizationId: string) {
  return withActionResult('getMyAiSubmissions', async () => {
    const { userId } = await assertOrgRole(organizationId);
    const session = await createSessionClient();
    const { data, error } = await session.from('ai_import_candidates')
      .select('id, source_file_name, created_at, payload')
      .eq('organization_id', organizationId)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw sanitizeDbError(error, 'action.aiCandidates.history');
    return (data ?? []).map((candidate) => {
      const payload = candidate.payload && typeof candidate.payload === 'object' && !Array.isArray(candidate.payload)
        ? candidate.payload : {};
      const meta = payload.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta)
        ? payload.meta : {};
      return {
        id: candidate.id,
        authorId: userId,
        sourceFileName: candidate.source_file_name,
        createdAt: candidate.created_at,
        recordDate: typeof meta.date === 'string' ? meta.date : null,
        startTime: typeof meta.start_at === 'string' && /^\d{2}:\d{2}$/.test(meta.start_at) ? meta.start_at : null,
        clientName: typeof meta.client_name === 'string' ? meta.client_name : null,
      };
    });
  });
}

/** A report reviewer turns one submitted AI reading into an approved report. */
export async function approveAiCandidate(input: ReviewCandidateInput) {
  return withActionResult('approveAiCandidate', async () => {
    const user = await getAuthedUser();
    await assertOrgPermission(input.organizationId, 'reports');
    await assertRecordPermission(input.organizationId, 'create', { clientId: input.clientId });
    await assertRecordPermission(input.organizationId, 'approve', { clientId: input.clientId });
    if (!UUID_PATTERN.test(input.candidateId) || !UUID_PATTERN.test(input.staffId)) throw new ExpectedActionError('VALIDATION_ERROR', '候補またはスタッフIDが不正です');
    if (!Number.isInteger(input.travelCostYen) || input.travelCostYen < 0 || input.travelCostYen > 100000
        || !['car', 'public_transport', 'other', 'none'].includes(input.travelMethod)
        || (input.travelMethod === 'none' && input.travelCostYen !== 0)) {
      throw new ExpectedActionError('VALIDATION_ERROR', '交通費を確認してください');
    }

    const session = await createSessionClient();
    const { data: reportId, error } = await session.rpc('approve_ai_import_candidate', {
      p_organization_id: input.organizationId,
      p_candidate_id: input.candidateId,
      p_client_id: input.clientId,
      p_staff_id: input.staffId,
      p_start_at: input.startAt,
      p_end_at: input.endAt,
      p_values: asJson(input.values),
      p_travel_method: input.travelMethod,
      p_travel_cost_yen: input.travelCostYen,
      p_session_id: user.sessionId,
    });
    if (error) throw sanitizeRpcError(error, 'action.aiCandidates.approve', [
      { databaseCode: '42501', databaseMessage: 'permission_denied', code: 'FORBIDDEN', message: 'AI送信を承認する権限がありません' },
      { databaseCode: '22023', databaseMessage: 'invalid_ai_review', code: 'VALIDATION_ERROR', message: '日時・記録内容・交通費を確認してください' },
      { databaseCode: 'P0002', databaseMessage: 'candidate_not_found', code: 'NOT_FOUND', message: '対象のAI送信が見つかりません。一覧を再読み込みしてください' },
      { databaseCode: 'P0002', databaseMessage: 'staff_not_found', code: 'NOT_FOUND', message: '対象スタッフが見つかりません' },
    ]);
    if (!reportId) throw new Error('AI approval returned no report ID');
    return { reportId };
  });
}
