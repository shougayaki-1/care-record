'use server';

import { saveReport, type SaveReportInput } from '@/app/actions/reports';
import { assertRecordPermission, createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { serviceRoleForAiImportProvenance } from '@/utils/supabase/serviceRole';

type SaveCandidateInput = Pick<SaveReportInput, 'organizationId' | 'clientId' | 'startAt' | 'endAt' | 'values'> & {
  candidateId: string;
};

export async function saveAiCandidateAsDraft(input: SaveCandidateInput) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.candidateId)) throw new Error('候補IDが不正です');
  const user = await getAuthedUser();
  await assertRecordPermission(input.organizationId, 'edit', { clientId: input.clientId });
  const session = await createSessionClient();
  const { data: candidate, error: candidateError } = await session.from('ai_import_candidates')
    .select('id, organization_id, created_by, source_file_name')
    .eq('id', input.candidateId)
    .eq('organization_id', input.organizationId)
    .eq('created_by', user.id)
    .maybeSingle();
  if (candidateError || !candidate) throw new Error('確認対象のAI候補が見つかりません');

  const values = { ...input.values };
  delete values._ai_import_source;
  delete values._ai_import_candidate_id;
  const saved = await saveReport({
    organizationId: input.organizationId,
    clientId: input.clientId,
    startAt: input.startAt,
    endAt: input.endAt,
    values,
    status: 'draft',
    expectedVersion: 0,
    idempotencyKey: input.candidateId,
  });
  const provenance = {
    report_id: saved.reportId,
    candidate_id: candidate.id,
    organization_id: input.organizationId,
    reviewed_by: user.id,
    source_file_name: candidate.source_file_name,
  };
  const serviceRole = serviceRoleForAiImportProvenance();
  const { error: provenanceError } = await serviceRole.from('ai_import_provenance').insert(provenance);
  if (provenanceError) {
    const { data: existing } = await serviceRole.from('ai_import_provenance')
      .select('report_id, candidate_id')
      .eq('candidate_id', candidate.id)
      .maybeSingle();
    if (existing?.report_id !== saved.reportId) {
      throw new Error('記録は保存されましたが、AI取込の証跡を保存できませんでした。再試行してください');
    }
  }
  const { error: deleteError } = await session.from('ai_import_candidates')
    .delete().eq('id', candidate.id).eq('organization_id', input.organizationId);
  if (deleteError) throw new Error('記録は保存されましたが、候補を削除できませんでした。再試行してください');
  return saved;
}
