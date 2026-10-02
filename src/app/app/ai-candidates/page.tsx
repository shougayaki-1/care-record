'use client';

import { commitRecordChange } from '@/utils/recordFeedUpdates';
import { useCallback, useEffect, useState } from 'react';
import { Alert, CircularProgress, Stack } from '@/components/ui/mui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { supabase } from '@/lib/supabase';
import { approveAiCandidate } from '@/app/actions/aiCandidates';
import { DEFAULT_TEMPLATE, type FormItem } from '@/constants/formTemplates';
import { AiImportReviewTable, type ReviewRow } from '@/components/ui/AiImportReviewTable';
import { RawExtractionResponseSchema } from '@/lib/ai/mcpCandidateSchema';
import { normalizeExtraction } from '@/lib/ai/normalizeExtraction';
import { checkManagementPermission } from '@/utils/permissions';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { InnerPageHeader, PageBody, PageLayout } from '@/components/ui';
import { RecordListFilterBar } from '@/components/record/RecordListFilterBar';

type Candidate = {
  id: string;
  source_file_name: string;
  payload: unknown;
};
type NamedId = { id: string; name: string };

export default function AiCandidatesPage() {
  const { currentOrg } = useWorkspace();
  const canReview = Boolean(currentOrg && checkManagementPermission(currentOrg.effectivePermissions, 'reports'));
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [clients, setClients] = useState<NamedId[]>([]);
  const [helpers, setHelpers] = useState<NamedId[]>([]);
  const [templatesByClient, setTemplatesByClient] = useState<Record<string, FormItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) {
      return;
    }
    let active = true;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      const [candidateResult, clientResult, helperResult] = await Promise.all([
        supabase.from('ai_import_candidates')
          .select('id, source_file_name, payload')
          .eq('organization_id', currentOrg.id)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id).is('archived_at', null).order('name'),
        supabase.from('staffs').select('id, name').eq('organization_id', currentOrg.id).is('deleted_at', null).order('name'),
      ]);
      if (!active) return;
      if (candidateResult.error || clientResult.error || helperResult.error) {
        setLoadError('AI取込候補を読み込めませんでした。ログイン状態と事業所を確認してください。');
        setLoading(false);
        return;
      }
      const clientRows = (clientResult.data ?? []) as NamedId[];
      const helperRows = (helperResult.data ?? []) as NamedId[];
      const { data: templateRows, error: templateError } = clientRows.length > 0
        ? await supabase.from('form_templates').select('client_id, schema').in('client_id', clientRows.map((client) => client.id))
        : { data: [], error: null };
      if (!active) return;
      if (templateError) {
        setLoadError('記録フォームを読み込めませんでした。');
        setLoading(false);
        return;
      }
      const templates = Object.fromEntries((templateRows ?? []).filter((item) => Array.isArray(item.schema))
        .map((item) => [item.client_id, item.schema as FormItem[]]));
      setClients(clientRows);
      setHelpers(helperRows);
      setTemplatesByClient(templates);
      const nextRows: ReviewRow[] = ((candidateResult.data ?? []) as Candidate[]).map((candidate, index) => {
        const parsed = RawExtractionResponseSchema.safeParse({ records: [candidate.payload] });
        if (!parsed.success) {
          return {
            id: candidate.id, fileIndex: index, fileName: candidate.source_file_name || 'AIチャットのPDF',
            fileType: '', previewUrl: null, fileCount: 1, sourceKind: 'ai_chat', result: null,
            errorMessage: 'AIのデータ形式が不正です', date: '', startAt: '', endAt: '', travelTime: '',
            clientId: null, helperId: null, status: 'error' as const,
          };
        }
        const raw = parsed.data.records[0];
        const namedClient = clientRows.find((client) => client.name.normalize('NFKC').replace(/\s+/g, '') === raw.meta.client_name?.normalize('NFKC').replace(/\s+/g, ''));
        const result = normalizeExtraction(raw, namedClient ? templates[namedClient.id] ?? DEFAULT_TEMPLATE : DEFAULT_TEMPLATE, clientRows, helperRows);
        const matchedClient = clientRows.find((client) => client.id === result.meta.client_id_candidate)
          ?? clientRows.find((client) => client.name.normalize('NFKC').replace(/\s+/g, '') === result.meta.client_name?.normalize('NFKC').replace(/\s+/g, ''));
        const matchedHelper = helperRows.find((helper) => result.meta.helper_id_candidates.includes(helper.id))
          ?? helperRows.find((helper) => result.meta.helper_names.some((name) => helper.name.normalize('NFKC').replace(/\s+/g, '') === name.normalize('NFKC').replace(/\s+/g, '')));
        return {
          id: candidate.id, fileIndex: index, fileName: candidate.source_file_name || 'AIチャットのPDF',
          fileType: '', previewUrl: null, fileCount: 1, sourceKind: 'ai_chat', result,
          date: result.meta.date ?? '', startAt: result.meta.start_at ?? '', endAt: result.meta.end_at ?? '',
          travelTime: result.meta.travel_time_hours == null ? '' : String(result.meta.travel_time_hours),
          clientId: matchedClient?.id ?? null, helperId: matchedHelper?.id ?? null, status: 'pending' as const,
        };
      });
      setRows(nextRows);
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [currentOrg]);

  const handleRowChange = useCallback((id: string, changes: Partial<ReviewRow>) => {
    if (changes.status === 'skipped' && currentOrg && canReview) {
      void (async () => {
        const accepted = await confirm({ message: 'このAI送信を却下しますか？', confirmText: '却下する', confirmColor: 'error' });
        if (!accepted) return;
        const { error } = await commitRecordChange(currentOrg.id, async () => {
          const result = await supabase.rpc('discard_ai_import_candidate', { p_organization_id: currentOrg.id, p_candidate_id: id });
          if (result.error) throw result.error;
          return result;
        }).catch((error) => ({ error }));
        if (error) showToast('AI送信を却下できませんでした', 'error');
        else setRows((previous) => previous.filter((row) => row.id !== id));
      })();
      return;
    }
    setRows((previous) => previous.map((row) => {
      if (row.id !== id) return row;
      const contentChanged = Object.keys(changes).some((key) => key !== 'status');
      return { ...row, ...changes, ...(contentChanged ? { status: 'pending' as const } : {}) };
    }));
  }, [canReview, confirm, currentOrg, showToast]);

  const handleApproveRow = useCallback(async (id: string): Promise<boolean> => {
    if (!currentOrg || !canReview) return false;
    const row = rows.find((item) => item.id === id);
    if (!row?.result || !row.clientId || !row.helperId || !row.travelMethod || row.travelCostYen === undefined) {
      showToast('利用者・スタッフ・交通費を確認してください', 'error');
      return false;
    }
    setSaving(true);
    try {
      const start = new Date(`${row.date}T${row.startAt}:00`);
      const end = new Date(`${row.date}T${row.endAt}:00`);
      if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end < start) end.setDate(end.getDate() + 1);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        throw new Error('日時を確認してください');
      }
      const travelTime = row.travelTime?.trim() ?? '';
      if (travelTime && (!Number.isFinite(Number(travelTime)) || Number(travelTime) < 0)) {
        throw new Error('移動時間を確認してください');
      }
      const payload = {
        candidateId: id,
        organizationId: currentOrg.id,
        clientId: row.clientId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        staffId: row.helperId,
        travelMethod: row.travelMethod,
        travelCostYen: Number(row.travelCostYen),
        values: {
          ...row.result.values,
          ...(travelTime ? { travel_time: travelTime } : {}),
        },
      } satisfies Parameters<typeof approveAiCandidate>[0];
      await commitRecordChange(currentOrg.id, () => approveAiCandidate(payload));
      setRows((previous) => previous.filter((item) => item.id !== id));
      showToast('AI送信を確認し、提供記録を承認しました', 'success');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '承認できませんでした', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [canReview, currentOrg, rows, showToast]);

  return (
    <PageLayout>
      <InnerPageHeader icon={<AutoFixHighIcon />} title="AI送信・要確認" />
      <PageBody maxWidth={false}>
        <RecordListFilterBar source="ai" canViewReports={canReview} />
        <Stack spacing={2}>
        <Alert severity="warning">
          職員がAIから送信した記録です。原本とAIの読み取り結果を照合し、必要な修正と交通費の確認を行ってから承認してください。
        </Alert>
        {!currentOrg ? <Alert severity="info">事業所を選択してください。</Alert> : loading ? <CircularProgress /> : loadError ? <Alert severity="error">{loadError}</Alert> : !canReview ? (
          <Alert severity="info">{rows.length > 0 ? `AIから送信済みの記録が ${rows.length} 件あります。管理者の確認をお待ちください。` : 'この事業所には確認待ちのAI送信がありません。'}</Alert>
        ) : (
          <AiImportReviewTable
            rows={rows}
            clients={clients}
            helpers={helpers}
            formTemplate={DEFAULT_TEMPLATE}
            templatesByClient={templatesByClient}
            onRowChange={handleRowChange}
            onSaveSelected={async () => {}}
            onApproveRow={handleApproveRow}
            workflow="review_submissions"
            saving={saving}
          />
        )}
        </Stack>
      </PageBody>
    </PageLayout>
  );
}
