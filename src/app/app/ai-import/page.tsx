'use client';

import { commitRecordChange } from '@/utils/recordFeedUpdates';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AiFilePicker, AppButton, PageLayout, RecordFormHeader, RecordFormBody, ScrollableActions } from '@/components/ui';
import {
  Alert,
  Box,
  Checkbox,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@/components/ui/mui';
import DeleteIcon from '@mui/icons-material/Delete';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ImageIcon from '@mui/icons-material/Image';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import { saveReport } from '@/app/actions/reports';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import { AiImportReviewTable, type ReviewRow } from '@/components/ui/AiImportReviewTable';
import { AiInfoPanel } from '@/components/ui/AiInfoPanel';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { readAiExtractSse } from '@/lib/ai/sseClient';

type FileEntry = {
  id: string;
  file: File;
  groupId: string | null; // null = ungrouped, string = group UUID
  previewUrl: string | null;
};

type FileGroup = {
  id: string;
  fileIds: string[];
};

type Candidate = { id: string; name: string };

/** AIの名前照合: 候補リストからファジー一致でIDを返す */
function matchName(aiName: string, candidates: Candidate[]): string | null {
  if (!aiName) return null;
  const found = candidates.find(
    (c) => c.name.includes(aiName) || aiName.includes(c.name),
  );
  return found?.id ?? null;
}

function pickCandidateId(candidateId: string | null | undefined, candidates: Candidate[]): string | null {
  if (!candidateId) return null;
  return candidates.some((candidate) => candidate.id === candidateId) ? candidateId : null;
}

function pickFirstCandidateId(candidateIds: string[] | undefined, candidates: Candidate[]): string | null {
  for (const candidateId of candidateIds ?? []) {
    const matched = pickCandidateId(candidateId, candidates);
    if (matched) return matched;
  }
  return null;
}

function buildProcessingGroups(fileEntries: FileEntry[], groups: FileGroup[]): number[][] {
  const groupedIndices = new Set<number>();
  const result: number[][] = [];

  for (const group of groups) {
    const indices = group.fileIds
      .map((fid) => fileEntries.findIndex((entry) => entry.id === fid))
      .filter((index) => index >= 0);
    if (indices.length > 0) {
      indices.forEach((index) => groupedIndices.add(index));
      result.push(indices);
    }
  }

  fileEntries.forEach((_, index) => {
    if (!groupedIndices.has(index)) result.push([index]);
  });

  return result;
}

function isValidDraftTime(date: string, startAt: string, endAt: string): boolean {
  const start = new Date(`${date}T${startAt}:00`);
  const end = new Date(`${date}T${endAt}:00`);
  return Boolean(date && startAt && endAt && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start);
}

/** SSEストリームを読んで ExtractionResult を収集する */
async function streamExtract(
  formData: FormData,
  onRecord: (result: ExtractionResult, fileIndex: number) => void,
  onError: (message: string, fileIndex: number) => void,
  onGroupDone: (fileIndex: number) => void,
): Promise<number> {
  const orgId = (formData.get('organizationId') as string) ?? '';
  const extractUrl = `/api/ai/extract?organizationId=${encodeURIComponent(orgId)}`;
  const response = await fetch(extractUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `サーバーエラー (${response.status})`);
  }

  let total = 0;

  await readAiExtractSse(response.body, (event) => {
    if (event.type === 'record') {
      onRecord(event.result, event.fileIndex);
    } else if (event.type === 'error') {
      onError(event.message, event.fileIndex);
    } else if (event.type === 'group_done') {
      onGroupDone(event.fileIndex);
    } else if (event.type === 'done') {
      total = event.total;
    }
  });

  return total;
}

export default function AiImportPage() {
  const { currentOrg } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  const [clients, setClients] = useState<Candidate[]>([]);
  const [helpers, setHelpers] = useState<Candidate[]>([]);

  // ファイルリスト・グループ
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [groups, setGroups] = useState<FileGroup[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  // 処理状態
  const [processing, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [processError, setProcessError] = useState<string | null>(null);

  // 結果行
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 利用者・スタッフ取得
  useEffect(() => {
    if (!currentOrg) return;
    const fetchCandidates = async () => {
      const [{ data: clientData }, { data: staffData }] = await Promise.all([
        supabase
          .from('clients')
          .select('id, name')
          .eq('organization_id', currentOrg.id)
          .is('archived_at', null)
          .order('name', { ascending: true }),
        supabase
          .from('staffs')
          .select('id, name')
          .eq('organization_id', currentOrg.id)
          .is('archived_at', null)
          .order('name', { ascending: true }),
      ]);
      setClients((clientData ?? []) as Candidate[]);
      setHelpers((staffData ?? []) as Candidate[]);
    };
    void fetchCandidates();
  }, [currentOrg]);

  // ファイル追加
  const addFiles = useCallback((files: File[]) => {
    const allowed = files.filter((f) =>
      f.type === 'application/pdf' ||
      f.type.startsWith('image/jpeg') ||
      f.type.startsWith('image/png') ||
      f.type.startsWith('image/webp'),
    );
    const entries: FileEntry[] = allowed.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      groupId: null,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    }));
    setFileEntries((prev) => [...prev, ...entries]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const removeFile = (id: string) => {
    const target = fileEntries.find((f) => f.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    setFileEntries((prev) => prev.filter((f) => f.id !== id));
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, fileIds: g.fileIds.filter((fid) => fid !== id) }))
        .filter((g) => g.fileIds.length > 0),
    );
  };

  const toggleSelectFile = (id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mergeSelected = () => {
    if (selectedFileIds.size < 2) return;
    const ids = Array.from(selectedFileIds);
    const selectedEntries = fileEntries.filter((entry) => ids.includes(entry.id));
    if (selectedEntries.some((entry) => !entry.file.type.startsWith('image/'))) {
      showToast('PDFは単独で処理します。画像ファイルだけを選択してください。', 'warning');
      return;
    }
    const groupId = crypto.randomUUID();
    setGroups((prev) => {
      // Remove these ids from any existing group
      const cleaned = prev.map((g) => ({
        ...g,
        fileIds: g.fileIds.filter((fid) => !ids.includes(fid)),
      })).filter((g) => g.fileIds.length > 0);
      return [...cleaned, { id: groupId, fileIds: ids }];
    });
    setFileEntries((prev) =>
      prev.map((f) => (ids.includes(f.id) ? { ...f, groupId } : f)),
    );
    setSelectedFileIds(new Set());
  };

  const ungroupFile = (id: string) => {
    setFileEntries((prev) =>
      prev.map((f) => (f.id === id ? { ...f, groupId: null } : f)),
    );
    setGroups((prev) => {
      const next = prev
        .map((g) => ({ ...g, fileIds: g.fileIds.filter((fid) => fid !== id) }))
        .filter((g) => g.fileIds.length > 0);
      return next;
    });
  };

  // 処理開始
  const handleProcess = async () => {
    if (!currentOrg || fileEntries.length === 0) return;
    if (rows.length > 0) {
      const ok = await confirm({ message: '現在の確認結果がクリアされます。続けますか？' });
      if (!ok) return;
    }
    setProcessing(true);
    setProcessedCount(0);
    setTotalCount(0);
    setProcessError(null);
    setRows([]);

    try {
      const formData = new FormData();
      formData.set('organizationId', currentOrg.id);
      formData.set('formTemplate', JSON.stringify(DEFAULT_TEMPLATE));
      formData.set('clients', JSON.stringify(clients));
      formData.set('helpers', JSON.stringify(helpers));

      // グループ情報を構築
      // fileIndex はファイルエントリの順序
      const orderedEntries = [...fileEntries];
      for (const entry of orderedEntries) {
        formData.append('files[]', entry.file);
      }

      const processingGroups = buildProcessingGroups(orderedEntries, groups);
      formData.set('grouping', JSON.stringify(processingGroups));

      setTotalCount(processingGroups.length);

      await streamExtract(
        formData,
        (result, fileIndex) => {
          const aiMeta = result.meta;
          const clientId =
            pickCandidateId(aiMeta.client_id_candidate, clients) ??
            matchName(aiMeta.client_name, clients);
          const helperId =
            pickFirstCandidateId(aiMeta.helper_id_candidates, helpers) ??
            (aiMeta.helper_names.length > 0
              ? matchName(aiMeta.helper_names[0], helpers)
              : null);

          const row: ReviewRow = {
            id: crypto.randomUUID(),
            fileIndex,
            fileName: orderedEntries[fileIndex]?.file.name ?? '',
            fileType: orderedEntries[fileIndex]?.file.type ?? '',
            previewUrl: orderedEntries[fileIndex]?.previewUrl ?? null,
            fileCount: processingGroups.find((group) => group[0] === fileIndex)?.length ?? 1,
            result,
            date: aiMeta.date,
            startAt: aiMeta.start_at,
            endAt: aiMeta.end_at,
            clientId,
            helperId,
            status: 'pending',
          };
          setRows((prev) => [...prev, row]);
        },
        (message, fileIndex) => {
          const row: ReviewRow = {
            id: crypto.randomUUID(),
            fileIndex,
            fileName: orderedEntries[fileIndex]?.file.name ?? '',
            fileType: orderedEntries[fileIndex]?.file.type ?? '',
            previewUrl: orderedEntries[fileIndex]?.previewUrl ?? null,
            fileCount: processingGroups.find((group) => group[0] === fileIndex)?.length ?? 1,
            result: null,
            errorMessage: message,
            date: '',
            startAt: '',
            endAt: '',
            clientId: null,
            helperId: null,
            status: 'error',
          };
          setRows((prev) => [...prev, row]);
          setProcessError(message);
        },
        () => {
          setProcessedCount((n) => n + 1);
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI処理中にエラーが発生しました';
      setProcessError(msg);
    } finally {
      setProcessing(false);
    }
  };

  const handleRowChange = (id: string, changes: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  };

  const handleSaveSelected = useCallback(async (ids: string[]) => {
    if (!currentOrg) return;
    setSaving(true);

    // Mark all as saving
    setRows((prev) =>
      prev.map((r) => (ids.includes(r.id) ? { ...r, saveStatus: 'saving' } : r)),
    );

    const results = await commitRecordChange(currentOrg.id, () => Promise.allSettled(
      ids.map(async (id) => {
        const row = rows.find((r) => r.id === id);
        if (!row || !row.clientId) throw new Error('利用者が未選択です');
        if (!row.helperId) throw new Error('スタッフが未選択です');
        if (!row.result) throw new Error('読み取り結果がありません');
        if (!isValidDraftTime(row.date, row.startAt, row.endAt)) {
          throw new Error('開始・終了日時が不正です');
        }
        const helper = helpers.find((h) => h.id === row.helperId);
        if (!helper) throw new Error('スタッフが未選択です');

        const date = row.date;
        const startAt = `${date}T${row.startAt}:00`;
        const endAt = `${date}T${row.endAt}:00`;

        const payload = {
          organizationId: currentOrg.id,
          clientId: row.clientId,
          startAt,
          endAt,
          status: 'draft',
          values: { ...row.result.values, _helpers: [helper.name] },
          expectedVersion: 0,
          idempotencyKey: crypto.randomUUID(),
          auditSource: 'ai_import',
          auditFileCount: row.fileCount,
        } satisfies Parameters<typeof saveReport>[0];
        await saveReport(payload);
        return id;
      }),
    ), (batch) => batch.some((result) => result.status === 'fulfilled'));

    setRows((prev) =>
      prev.map((r) => {
        if (!ids.includes(r.id)) return r;
        const result = results[ids.indexOf(r.id)];
        if (result.status === 'fulfilled') return { ...r, saveStatus: 'saved' };
        return { ...r, saveStatus: 'error' };
      }),
    );

    const errorCount = results.filter((r) => r.status === 'rejected').length;
    const savedCount = results.filter((r) => r.status === 'fulfilled').length;
    if (savedCount > 0) {
      showToast(`${savedCount} 件を下書き保存しました`, 'success');
    }
    if (errorCount > 0) {
      showToast(`${errorCount} 件の保存に失敗しました`, 'error');
    }
    setSaving(false);
  }, [rows, currentOrg, helpers, showToast]);

  const fileIcon = (file: File) => {
    if (file.type === 'application/pdf') return <PictureAsPdfIcon fontSize="small" color="error" />;
    return <ImageIcon fontSize="small" color="primary" />;
  };

  // グループ表示用のマップ
  const groupByGroupId = new Map(groups.map((g) => [g.id, g]));

  // ファイルリスト表示（グループ単位でまとめる）
  const renderedGroupIds = new Set<string>();
  const fileListItems: React.ReactNode[] = [];
  for (const entry of fileEntries) {
    if (entry.groupId && !renderedGroupIds.has(entry.groupId)) {
      renderedGroupIds.add(entry.groupId);
      const grp = groupByGroupId.get(entry.groupId);
      if (!grp) continue;
      const grpEntries = grp.fileIds
        .map((fid) => fileEntries.find((e) => e.id === fid))
        .filter(Boolean) as FileEntry[];
      fileListItems.push(
        <Box key={`group-${entry.groupId}`} sx={{ border: '1px dashed', borderColor: 'primary.light', borderRadius: 1, p: 0.5, mb: 0.5 }}>
          <Typography variant="caption" color="primary" sx={{ pl: 1 }}>
            グループ（{grpEntries.length} ファイル → 1記録）
          </Typography>
          {grpEntries.map((ge) => (
            <ListItem key={ge.id} disablePadding sx={{ pl: 2 }}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Checkbox
                  size="small"
                  checked={selectedFileIds.has(ge.id)}
                  onChange={() => toggleSelectFile(ge.id)}
                  disabled={processing}
                />
              </ListItemIcon>
              <ListItemIcon sx={{ minWidth: 28 }}>{fileIcon(ge.file)}</ListItemIcon>
              <ListItemText
                primary={ge.file.name}
                primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }}
              />
              <Tooltip title="グループから外す">
                <IconButton size="small" onClick={() => ungroupFile(ge.id)} disabled={processing}>
                  <MergeTypeIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton size="small" onClick={() => removeFile(ge.id)} disabled={processing}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </ListItem>
          ))}
        </Box>,
      );
    } else if (!entry.groupId) {
      fileListItems.push(
        <ListItem key={entry.id} disablePadding>
          <ListItemIcon sx={{ minWidth: 28 }}>
            <Checkbox
              size="small"
              checked={selectedFileIds.has(entry.id)}
              onChange={() => toggleSelectFile(entry.id)}
              disabled={processing}
            />
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 28 }}>{fileIcon(entry.file)}</ListItemIcon>
          <ListItemText
            primary={entry.file.name}
            primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }}
          />
          <IconButton size="small" onClick={() => removeFile(entry.id)} disabled={processing}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </ListItem>,
      );
    }
  }

  const handleClose = async () => {
    if (processing || saving) return;
    if ((fileEntries.length > 0 || rows.some((row) => row.saveStatus !== 'saved')) && !await confirm({ title: '保存されていない変更があります', message: '選択したファイルや未保存の確認内容があります。保存せず閉じますか？', confirmText: '保存せず閉じる', confirmColor: 'warning' })) return;
    router.back();
  };

  return (
    <PageLayout>
      <RecordFormHeader title="AI一括取込" onClose={() => void handleClose()} disabled={processing || saving} actions={<>
        {fileEntries.length > 0 && !processing && <AppButton intent="secondary" variant="text" size="small" disabled={saving} onClick={() => {
          fileEntries.forEach((entry) => { if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl); });
          setFileEntries([]);
          setGroups([]);
          setSelectedFileIds(new Set());
          setRows([]);
          setProcessError(null);
        }}>クリア</AppButton>}
        <AppButton size="small" startIcon={<AutoFixHighIcon />} disabled={fileEntries.length === 0 || !currentOrg} loading={processing} onClick={() => void handleProcess()}>
          {processing ? '処理中...' : '処理開始'}
        </AppButton>
      </>} />
      <RecordFormBody>
        <AiInfoPanel variant="page" />
        <Box>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom>原本ファイル</Typography>
          <AiFilePicker inputRef={fileInputRef} onChange={handleFileInput} onDrop={handleDrop} multiple disabled={processing} />
        </Box>

      {/* ファイルリスト */}
      {fileEntries.length > 0 && (
        <Box sx={{ mb: 2, p: 1, borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
            <Typography variant="subtitle2">{fileEntries.length} ファイル選択中</Typography>
            <Tooltip title="選択したファイルを1記録としてまとめる">
              <ScrollableActions aria-label="ファイル操作" role="group" tabIndex={0}>
                <AppButton intent="secondary"
                  size="small"
                  startIcon={<MergeTypeIcon />}
                  disabled={selectedFileIds.size < 2 || processing}
                  onClick={mergeSelected}
                  variant="outlined"
                >
                  1記録としてまとめる
                </AppButton>
              </ScrollableActions>
            </Tooltip>
          </Stack>
          <List dense>{fileListItems}</List>
        </Box>
      )}

      {/* 進捗 */}
      {processing && (
        <Box mb={2}>
          <Typography variant="body2" color="text.secondary" mb={0.5}>
            {processedCount} / {totalCount || fileEntries.length} 件処理中...
          </Typography>
          <LinearProgress
            variant={totalCount > 0 ? 'determinate' : 'indeterminate'}
            value={totalCount > 0 ? (processedCount / totalCount) * 100 : undefined}
          />
        </Box>
      )}

      {processError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setProcessError(null)}>
          {processError}
        </Alert>
      )}

      {/* 結果テーブル */}
      {rows.length > 0 && (
        <Box sx={{ py: 2 }}>
          <AiImportReviewTable
            rows={rows}
            clients={clients}
            helpers={helpers}
            formTemplate={DEFAULT_TEMPLATE}
            onRowChange={handleRowChange}
            onSaveSelected={handleSaveSelected}
            saving={saving}
          />
        </Box>
      )}
      </RecordFormBody>
    </PageLayout>
  );
}
