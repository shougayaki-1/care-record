'use client';

import { useState } from 'react';
import {
  Alert, Box, Stack, Typography,
} from '@/components/ui/mui';
import { AppButton } from './AppButton';
import { DateTimeField, NumberField, SelectField } from './Fields';
import { RecordFormDialog } from './RecordFormLayout';
import { ScrollableActions } from './Layout';
import { UnitAdornment } from './UnitAdornment';
import SaveIcon from '@mui/icons-material/Save';
import { RecordListTable, type RecordListRow } from '@/components/record/RecordListTable';
import { RecordDynamicSections } from '@/components/record/RecordDynamicSections';
import type { FormAnswers } from '@/hooks/useRecordForm';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import type { FormItem } from '@/lib/ai/extractPrompt';

export type ReviewRow = {
  id: string;
  fileIndex: number;
  fileName: string;
  fileType: string;
  previewUrl: string | null;
  sourceFiles?: { fileName: string; fileType: string; previewUrl: string | null }[];
  sourceKind?: 'ai_chat';
  fileCount: number;
  result: ExtractionResult | null;
  errorMessage?: string;
  date: string;
  startAt: string;
  endAt: string;
  travelTime?: string;
  clientId: string | null;
  helperId: string | null;
  travelMethod?: 'car' | 'public_transport' | 'other' | 'none' | '';
  travelCostYen?: string;
  status: 'pending' | 'confirmed' | 'skipped' | 'error';
  saveStatus?: 'saving' | 'saved' | 'error';
  saveError?: string;
};

export type AiImportReviewTableProps = {
  rows: ReviewRow[];
  clients: { id: string; name: string }[];
  helpers: { id: string; name: string }[];
  formTemplate: FormItem[];
  templatesByClient?: Record<string, FormItem[]>;
  onRowChange: (id: string, changes: Partial<ReviewRow>) => void;
  onSaveSelected: (ids: string[]) => Promise<void>;
  onApproveRow?: (id: string) => Promise<boolean>;
  workflow?: 'draft_import' | 'review_submissions';
  saving: boolean;
};

function groupSections(template: FormItem[]) {
  const sections: { title: string; items: FormItem[] }[] = [];
  for (const item of template) {
    if (item.type === 'section') sections.push({ title: item.label, items: [] });
    else {
      if (sections.length === 0) sections.push({ title: '記録内容', items: [] });
      sections[sections.length - 1].items.push(item);
    }
  }
  return sections;
}

function locateWarnings(warnings: string[], template: FormItem[]) {
  const fields: Record<string, string> = {};
  const meta: Record<string, string> = {};
  const unmatched: string[] = [];
  for (const warning of warnings) {
    const item = template.filter((field) => field.type !== 'section').sort((a, b) => b.label.length - a.label.length).find((field) =>
      warning.startsWith(`${field.label}:`) || warning.startsWith(`${field.label}：`) ||
      warning.startsWith(`${field.label}の詳細`) || warning.startsWith(`${field.id}:`) ||
      warning.includes(`「${field.label}」`) || warning.includes(field.label),
    );
    if (item) {
      fields[item.id] = [fields[item.id], warning].filter(Boolean).join(' / ');
      continue;
    }
    const key = /移動/.test(warning) ? 'travel'
      : /利用者/.test(warning) ? 'client'
      : /スタッフ|担当/.test(warning) ? 'helper'
      : /開始/.test(warning) ? 'start'
      : /終了/.test(warning) ? 'end'
      : /日付|記録日/.test(warning) ? 'date' : null;
    if (key) meta[key] = [meta[key], warning].filter(Boolean).join(' / ');
    else unmatched.push(warning);
  }
  return { fields, meta, unmatched };
}

const statusLabel = (row: ReviewRow) => row.saveStatus === 'saved' ? '保存済み'
  : row.saveStatus === 'error' ? '保存エラー'
  : row.status === 'confirmed' ? '確認済み'
  : row.status === 'error' ? '読取失敗'
  : row.status === 'skipped' ? 'スキップ' : '要確認';

const statusColor = (row: ReviewRow, reviewingSubmissions: boolean): 'error' | 'success' | 'warning' => row.status === 'error' || row.saveStatus === 'error' ? 'error'
  : !reviewingSubmissions && (row.status === 'confirmed' || row.saveStatus === 'saved') ? 'success' : 'warning';

export function AiImportReviewTable({ rows, clients, helpers, formTemplate, templatesByClient, onRowChange, onSaveSelected, onApproveRow, workflow = 'draft_import', saving }: AiImportReviewTableProps) {
  const reviewingSubmissions = workflow === 'review_submissions';
  const [reviewId, setReviewId] = useState<string | null>(null);
  const reviewRow = rows.find((row) => row.id === reviewId);
  const start = reviewRow ? new Date(`${reviewRow.date}T${reviewRow.startAt}:00`) : null;
  const end = reviewRow ? new Date(`${reviewRow.date}T${reviewRow.endAt}:00`) : null;
  if (start && end && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end < start) end.setDate(end.getDate() + 1);
  const travel = reviewRow?.travelTime?.trim() ?? '';
  const cost = reviewRow?.travelCostYen?.trim() ?? '';
  const validExpense = Boolean(reviewRow?.travelMethod && cost !== '' && Number.isInteger(Number(cost)) && Number(cost) >= 0 && Number(cost) <= 100000 &&
    (reviewRow.travelMethod !== 'none' || Number(cost) === 0));
  const canConfirm = Boolean(reviewRow?.result && reviewRow.clientId && reviewRow.helperId && start && end &&
    Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start &&
    (!travel || (Number.isFinite(Number(travel)) && Number(travel) >= 0)) &&
    (!reviewingSubmissions || validExpense));
  const confirmedIds = rows.filter((row) => row.status === 'confirmed' && row.saveStatus !== 'saved' && row.saveStatus !== 'saving').map((row) => row.id);
  const activeTemplate = reviewRow?.clientId ? templatesByClient?.[reviewRow.clientId] ?? formTemplate : formTemplate;
  const sections = groupSections(activeTemplate);
  const { fields, meta, unmatched } = locateWarnings(reviewRow?.result?.warnings ?? [], activeTemplate);

  const changeAnswer = (id: string, value: FormAnswers[string]) => {
    if (!reviewRow?.result) return;
    const item = activeTemplate.find((field) => field.id === id);
    const values = { ...reviewRow.result.values };
    if (item?.type === 'number') {
      if (value === '' || !Number.isFinite(Number(value))) delete values[id];
      else values[id] = Number(value);
    } else if (id.endsWith('_detail') && value === '') delete values[id];
    else values[id] = value;
    onRowChange(reviewRow.id, { result: { ...reviewRow.result, values } });
  };

  const renderActions = (row: ReviewRow) => <ScrollableActions aria-label="AI記録の操作" role="group" tabIndex={0}>
    {row.result && row.status !== 'skipped' && row.saveStatus !== 'saved' && (
      <AppButton intent="secondary" size="small" variant="outlined" disabled={saving} onClick={() => setReviewId(row.id)}>内容を確認・修正</AppButton>
    )}
    {row.saveStatus !== 'saved' && row.status !== 'skipped' && (
      <AppButton size="small" variant="text" intent={reviewingSubmissions ? 'danger' : 'secondary'} disabled={saving} onClick={() => onRowChange(row.id, { status: 'skipped' })}>
        {reviewingSubmissions ? '却下' : row.sourceKind === 'ai_chat' ? '破棄' : 'スキップ'}
      </AppButton>
    )}
    {row.status === 'skipped' && <AppButton size="small" variant="text" intent="secondary" disabled={saving} onClick={() => onRowChange(row.id, { status: 'pending' })}>戻す</AppButton>}
  </ScrollableActions>;

  const listRows: RecordListRow[] = rows.map((row) => ({
    id: row.id,
    status: reviewingSubmissions && row.status !== 'error' ? '送信済み・要確認' : statusLabel(row),
    statusColor: statusColor(row, reviewingSubmissions),
    muted: row.status === 'skipped',
    start: `${row.date || '日付未入力'} ${row.startAt || '--:--'}`,
    end: row.endAt || '--:--',
    client: clients.find((item) => item.id === row.clientId)?.name ?? '利用者未選択',
    helper: helpers.find((item) => item.id === row.helperId)?.name ?? 'スタッフ未選択',
    detail: <>
      {row.sourceKind === 'ai_chat' && <Typography variant="caption" color="warning.main" display="block">AI取込・原本要確認</Typography>}
      {row.result?.confidence && <Typography variant="caption" color="text.secondary" display="block">AI自己評価: {{ high: '高', medium: '中', low: '低' }[row.result.confidence]}</Typography>}
      {row.fileCount > 1 && <Typography variant="caption" color="text.secondary" display="block">{row.fileCount}枚</Typography>}
      {row.saveError && <Typography variant="caption" color="error" display="block">{row.saveError}</Typography>}
      {row.errorMessage && <Typography variant="caption" color="error" display="block">{row.errorMessage}</Typography>}
    </>,
    actions: renderActions(row),
  }));

  return <Box>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mb: 2 }}>
      <Typography variant="body2" color="text.secondary">{reviewingSubmissions ? `${rows.length} 件のAI送信が確認待ちです` : `${rows.length} 件（確認済み: ${confirmedIds.length} 件）`}</Typography>
      {!reviewingSubmissions && <ScrollableActions aria-label="下書き保存操作" role="group" tabIndex={0}><AppButton variant="contained" size="small" startIcon={<SaveIcon />} loading={saving} disabled={confirmedIds.length === 0} onClick={() => void onSaveSelected(confirmedIds)}>
        選択した記録を下書き保存
      </AppButton></ScrollableActions>}
    </Stack>

    <RecordListTable rows={listRows} emptyMessage="確認待ちのAI送信がありません" />

    <RecordFormDialog open={Boolean(reviewRow)} onClose={() => { if (!saving) setReviewId(null); }} title="提供記録の確認・修正" loading={saving} actions={<>
      <AppButton intent="secondary" variant="text" size="small" onClick={() => setReviewId(null)} disabled={saving}>閉じる</AppButton>
        <AppButton size="small" loading={saving} disabled={!canConfirm} onClick={() => {
          if (!reviewRow) return;
          if (reviewingSubmissions && onApproveRow) {
            void onApproveRow(reviewRow.id).then((approved) => { if (approved) setReviewId(null); });
          } else {
            onRowChange(reviewRow.id, { status: 'confirmed' });
            setReviewId(null);
          }
        }}>{reviewingSubmissions ? '内容を確認して承認' : '原本と照合して確認済みにする'}</AppButton>
    </>}>
        {reviewRow?.saveError && <Alert severity="error">{reviewRow.saveError}</Alert>}
        {reviewRow?.result && <>
          {!canConfirm && <Alert severity="warning">利用者・スタッフ・日時・移動時間{reviewingSubmissions ? '・交通費' : ''}を確認してください</Alert>}
          {reviewRow.sourceKind === 'ai_chat' && <Alert severity="warning">AIチャットで読み取った候補です。原本PDFはこの画面に保存されていません。AIチャット側の原本と、日付・丸印・特記事項を照合してください。</Alert>}
          {(reviewRow.sourceFiles ?? [{ fileName: reviewRow.fileName, fileType: reviewRow.fileType, previewUrl: reviewRow.previewUrl }]).map((source, index) => source.previewUrl &&
            <Box key={`${source.fileName}-${index}`}>
              <Typography variant="subtitle2" gutterBottom sx={{ overflowWrap: 'anywhere' }}>{source.fileName}</Typography>
              {source.fileType === 'application/pdf'
                ? <Box component="iframe" src={source.previewUrl} title={source.fileName} sx={{ width: '100%', height: 400, border: 1, borderColor: 'divider' }} />
                : <Box component="img" src={source.previewUrl} alt={source.fileName} sx={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain' }} />}
            </Box>)}
          <Box sx={{ p: { xs: 2, sm: 3 }, borderRadius: 1, bgcolor: 'background.paper' }}>
            <Typography component="h3" variant="h6" fontWeight="bold" gutterBottom>基本情報</Typography>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <DateTimeField kind="date" disabled={saving} label="記録日" value={reviewRow.date} onChange={(event) => onRowChange(reviewRow.id, { date: event.target.value })} color={meta.date ? 'warning' : undefined} helperText={meta.date} slotProps={{ inputLabel: { shrink: true } }} />
                <DateTimeField kind="time" disabled={saving} label="開始時刻" value={reviewRow.startAt} onChange={(event) => onRowChange(reviewRow.id, { startAt: event.target.value })} color={meta.start ? 'warning' : undefined} helperText={meta.start} slotProps={{ inputLabel: { shrink: true } }} />
                <DateTimeField kind="time" disabled={saving} label="終了時刻" value={reviewRow.endAt} onChange={(event) => onRowChange(reviewRow.id, { endAt: event.target.value })} color={meta.end ? 'warning' : undefined} helperText={meta.end} slotProps={{ inputLabel: { shrink: true } }} />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <SelectField required label="利用者" value={reviewRow.clientId ?? ''} options={[{ value: '', label: '未選択' }, ...clients.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => onRowChange(reviewRow.id, { clientId: value || null })} disabled={saving} error={!reviewRow.clientId} helperText={meta.client || (!reviewRow.clientId ? '利用者を選択してください' : undefined)} />
                <SelectField required label="担当スタッフ" value={reviewRow.helperId ?? ''} options={[{ value: '', label: '未選択' }, ...helpers.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => onRowChange(reviewRow.id, { helperId: value || null })} disabled={saving} error={!reviewRow.helperId} helperText={meta.helper || (!reviewRow.helperId ? 'スタッフを選択してください' : undefined)} />
                <NumberField disabled={saving} label="移動時間" value={reviewRow.travelTime ?? ''} onChange={(event) => onRowChange(reviewRow.id, { travelTime: event.target.value })} color={meta.travel ? 'warning' : undefined} helperText={meta.travel} slotProps={{ input: { endAdornment: <UnitAdornment>時間</UnitAdornment> }, htmlInput: { min: 0, step: 0.25 } }} />
              </Stack>
              {reviewingSubmissions && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <SelectField required label="交通手段" value={reviewRow.travelMethod ?? ''} options={[{ value: '', label: '選択してください' }, { value: 'car', label: '車' }, { value: 'public_transport', label: '公共交通機関' }, { value: 'other', label: 'その他' }, { value: 'none', label: '交通費なし' }]} onChange={(value) => onRowChange(reviewRow.id, { travelMethod: value as ReviewRow['travelMethod'], ...(value === 'none' ? { travelCostYen: '0' } : {}) })} disabled={saving} error={!reviewRow.travelMethod} helperText={!reviewRow.travelMethod ? '交通手段を選択してください' : undefined} />
                <NumberField required disabled={saving} error={!validExpense} helperText={!validExpense ? '交通費を0〜100000円で確認してください' : undefined} label="交通費" value={reviewRow.travelCostYen ?? ''} onChange={(event) => onRowChange(reviewRow.id, { travelCostYen: event.target.value })} slotProps={{ input: { endAdornment: <UnitAdornment>円</UnitAdornment> }, htmlInput: { inputMode: 'numeric', min: 0, max: 100000, step: 1 } }} />
              </Stack>}
            </Stack>
          </Box>
          {unmatched.map((warning, index) => <Alert key={`${warning}-${index}`} severity="warning">{warning}</Alert>)}
          <RecordDynamicSections sections={sections} answers={reviewRow.result.values} errors={{}} warnings={fields} aiFilledFields={new Set()} headingComponent="h3" disabled={saving} onAnswerChange={changeAnswer} />
        </>}
    </RecordFormDialog>
  </Box>;
}
