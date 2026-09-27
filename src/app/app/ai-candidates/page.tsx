'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { supabase } from '@/lib/supabase';
import { saveAiCandidateAsDraft } from '@/app/actions/aiCandidates';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import { AiImportReviewTable, type ReviewRow } from '@/components/ui/AiImportReviewTable';
import { RawExtractionResponseSchema } from '@/lib/ai/mcpCandidateSchema';
import { normalizeExtraction } from '@/lib/ai/normalizeExtraction';

type Candidate = {
  id: string;
  source_file_name: string;
  payload: unknown;
};
type NamedId = { id: string; name: string };

export default function AiCandidatesPage() {
  const { currentOrg } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [clients, setClients] = useState<NamedId[]>([]);
  const [helpers, setHelpers] = useState<NamedId[]>([]);
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
      setClients(clientRows);
      setHelpers(helperRows);
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
        const result = normalizeExtraction(parsed.data.records[0], DEFAULT_TEMPLATE, clientRows, helperRows);
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
    if (changes.status === 'skipped' && currentOrg) {
      void (async () => {
        const accepted = await confirm({ message: 'このAI取込候補を破棄しますか？' });
        if (!accepted) return;
        const { error } = await supabase.from('ai_import_candidates')
          .delete().eq('id', id).eq('organization_id', currentOrg.id);
        if (error) showToast('候補を破棄できませんでした', 'error');
        else setRows((previous) => previous.filter((row) => row.id !== id));
      })();
      return;
    }
    setRows((previous) => previous.map((row) => {
      if (row.id !== id) return row;
      const contentChanged = Object.keys(changes).some((key) => key !== 'status');
      return { ...row, ...changes, ...(contentChanged ? { status: 'pending' as const } : {}) };
    }));
  }, [confirm, currentOrg, showToast]);

  const handleSaveSelected = useCallback(async (ids: string[]) => {
    if (!currentOrg) return;
    setSaving(true);
    const outcomes = await Promise.allSettled(ids.map(async (id) => {
      const row = rows.find((item) => item.id === id);
      if (!row?.result || !row.clientId || !row.helperId) throw new Error('利用者・スタッフを確認してください');
      const helper = helpers.find((item) => item.id === row.helperId);
      if (!helper) throw new Error('スタッフを確認してください');
      const start = new Date(`${row.date}T${row.startAt}:00`);
      const end = new Date(`${row.date}T${row.endAt}:00`);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        throw new Error('日時を確認してください');
      }
      const travelTime = row.travelTime?.trim() ?? '';
      if (travelTime && (!Number.isFinite(Number(travelTime)) || Number(travelTime) < 0)) {
        throw new Error('移動時間を確認してください');
      }
      await saveAiCandidateAsDraft({
        candidateId: id,
        organizationId: currentOrg.id,
        clientId: row.clientId,
        startAt: `${row.date}T${row.startAt}:00`,
        endAt: `${row.date}T${row.endAt}:00`,
        values: {
          ...row.result.values,
          _helpers: [helper.name],
          ...(travelTime ? { travel_time: travelTime } : {}),
        },
      });
      return id;
    }));
    setRows((previous) => previous.map((row) => {
      const index = ids.indexOf(row.id);
      if (index < 0) return row;
      return { ...row, saveStatus: outcomes[index].status === 'fulfilled' ? 'saved' : 'error' };
    }));
    const savedCount = outcomes.filter((item) => item.status === 'fulfilled').length;
    const errorCount = outcomes.length - savedCount;
    if (savedCount) showToast(`${savedCount}件を下書き保存しました`, 'success');
    if (errorCount) showToast(`${errorCount}件の保存・更新に失敗しました`, 'error');
    setSaving(false);
  }, [currentOrg, helpers, rows, showToast]);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h5" fontWeight="bold">AI取込候補の確認</Typography>
        <Alert severity="warning">
          ここに表示される内容は、ChatGPTやClaudeなどが読み取った未確認の候補です。原本PDFをAIチャットで開き、日付・チェック・丸印・特記事項を照合してください。確認するまで記録本体には保存されません。
        </Alert>
        {!currentOrg ? <Alert severity="info">事業所を選択してください。</Alert> : loading ? <CircularProgress /> : loadError ? <Alert severity="error">{loadError}</Alert> : rows.length === 0 ? (
          <Alert severity="info">この事業所には確認待ちのAI取込候補がありません。</Alert>
        ) : (
          <AiImportReviewTable
            rows={rows}
            clients={clients}
            helpers={helpers}
            formTemplate={DEFAULT_TEMPLATE}
            onRowChange={handleRowChange}
            onSaveSelected={handleSaveSelected}
            saving={saving}
          />
        )}
      </Stack>
    </Box>
  );
}
