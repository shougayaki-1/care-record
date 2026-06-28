'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@/components/ui/mui';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ImageIcon from '@mui/icons-material/Image';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import { saveReport } from '@/app/actions/reports';
import { DEFAULT_TEMPLATE } from '@/app/app/record/[clientId]/page';
import { AiImportReviewTable, type ReviewRow } from '@/components/ui/AiImportReviewTable';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';

type FileEntry = {
  id: string;
  file: File;
  groupId: string | null; // null = ungrouped, string = group UUID
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

/** SSEストリームを読んで ExtractionResult を収集する */
async function streamExtract(
  formData: FormData,
  onRecord: (result: ExtractionResult, fileIndex: number) => void,
  onError: (message: string, fileIndex: number) => void,
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  let currentEvent = '';
  let currentData = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        currentData = line.slice(5).trim();
      } else if (line === '') {
        if (currentEvent === 'record' && currentData) {
          try {
            const parsed = JSON.parse(currentData) as {
              type: string;
              index: number;
              fileIndex: number;
              result: ExtractionResult;
            };
            if (parsed.type === 'record' && parsed.result) {
              onRecord(parsed.result, parsed.fileIndex);
            }
          } catch {
            // ignore parse errors
          }
        } else if (currentEvent === 'error' && currentData) {
          try {
            const parsed = JSON.parse(currentData) as {
              type: string;
              fileIndex: number;
              message: string;
            };
            if (parsed.type === 'error') {
              onError(parsed.message, parsed.fileIndex);
            }
          } catch {
            // ignore
          }
        } else if (currentEvent === 'done' && currentData) {
          try {
            const parsed = JSON.parse(currentData) as { type: string; total: number };
            if (parsed.type === 'done') total = parsed.total;
          } catch {
            // ignore
          }
        }
        currentEvent = '';
        currentData = '';
      }
    }
  }

  return total;
}

export default function AiImportPage() {
  const { currentOrg } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();

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

  const dropRef = useRef<HTMLDivElement>(null);
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

      // グループ化: グループIDでまとめたファイルのインデックスリストを送る
      if (groups.length > 0) {
        const grouping = groups
          .map((g) => ({
            fileIndices: g.fileIds
              .map((fid) => orderedEntries.findIndex((e) => e.id === fid))
              .filter((i) => i >= 0),
          }))
          .filter((g) => g.fileIndices.length > 1);
        if (grouping.length > 0) {
          formData.set('grouping', JSON.stringify(grouping));
        }
      }

      setTotalCount(orderedEntries.length);

      await streamExtract(
        formData,
        (result, fileIndex) => {
          setProcessedCount((n) => n + 1);
          const aiMeta = result.meta;
          const clientId = matchName(aiMeta.client_name, clients);
          const helperId =
            aiMeta.helper_names.length > 0
              ? matchName(aiMeta.helper_names[0], helpers)
              : null;
          const autoConfirm =
            result.confidence === 'high' && clientId !== null && helperId !== null;

          const row: ReviewRow = {
            id: crypto.randomUUID(),
            fileIndex,
            result,
            date: aiMeta.date,
            startAt: aiMeta.start_at,
            endAt: aiMeta.end_at,
            clientId,
            helperId,
            status: autoConfirm ? 'confirmed' : 'pending',
          };
          setRows((prev) => [...prev, row]);
        },
        (message) => {
          setProcessError(message);
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

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const row = rows.find((r) => r.id === id);
        if (!row || !row.clientId) throw new Error('利用者が未選択です');

        const date = row.date;
        const startAt = `${date}T${row.startAt}:00`;
        const endAt = `${date}T${row.endAt}:00`;

        await saveReport({
          organizationId: currentOrg.id,
          clientId: row.clientId,
          startAt,
          endAt,
          status: 'draft',
          values: { data: row.result.values },
        });
        return id;
      }),
    );

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
  }, [rows, currentOrg, showToast]);

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

  return (
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" fontWeight="bold" mb={3}>
        AI一括取込
      </Typography>

      {/* アップロードエリア */}
      <Paper
        ref={dropRef}
        variant="outlined"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        sx={{
          p: 3,
          mb: 3,
          textAlign: 'center',
          border: '2px dashed',
          borderColor: 'primary.light',
          bgcolor: 'background.default',
          cursor: 'pointer',
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
        <CloudUploadIcon color="primary" sx={{ fontSize: 48, mb: 1 }} />
        <Typography color="text.secondary">
          PDFや画像（JPEG・PNG・WebP）をドラッグ&ドロップ、またはクリックして選択
        </Typography>
      </Paper>

      {/* ファイルリスト */}
      {fileEntries.length > 0 && (
        <Paper variant="outlined" sx={{ mb: 2, p: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2">{fileEntries.length} ファイル選択中</Typography>
            <Tooltip title="選択したファイルを1記録としてまとめる">
              <span>
                <Button
                  size="small"
                  startIcon={<MergeTypeIcon />}
                  disabled={selectedFileIds.size < 2 || processing}
                  onClick={mergeSelected}
                  variant="outlined"
                >
                  1記録としてまとめる
                </Button>
              </span>
            </Tooltip>
          </Box>
          <List dense>{fileListItems}</List>
        </Paper>
      )}

      {/* 処理ボタン */}
      <Stack direction="row" spacing={2} mb={3}>
        <Button
          variant="contained"
          startIcon={processing ? <CircularProgress size={18} color="inherit" /> : <AutoFixHighIcon />}
          disabled={fileEntries.length === 0 || processing}
          onClick={() => void handleProcess()}
        >
          {processing ? '処理中...' : '処理開始'}
        </Button>
        {fileEntries.length > 0 && !processing && (
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => {
              setFileEntries([]);
              setGroups([]);
              setSelectedFileIds(new Set());
              setRows([]);
              setProcessError(null);
            }}
          >
            クリア
          </Button>
        )}
      </Stack>

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
        <Paper variant="outlined" sx={{ p: 2 }}>
          <AiImportReviewTable
            rows={rows}
            clients={clients}
            helpers={helpers}
            onRowChange={handleRowChange}
            onSaveSelected={handleSaveSelected}
            saving={saving}
          />
        </Paper>
      )}
    </Box>
  );
}
