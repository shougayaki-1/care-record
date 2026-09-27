'use client';

import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@/components/ui/mui';
import { DynamicFormField, type DynamicFormValue } from './DynamicFormField';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SaveIcon from '@mui/icons-material/Save';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ImageIcon from '@mui/icons-material/Image';
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
  status: 'pending' | 'confirmed' | 'skipped' | 'error';
  saveStatus?: 'saving' | 'saved' | 'error';
};

export type AiImportReviewTableProps = {
  rows: ReviewRow[];
  clients: { id: string; name: string }[];
  helpers: { id: string; name: string }[];
  formTemplate: FormItem[];
  onRowChange: (id: string, changes: Partial<ReviewRow>) => void;
  onSaveSelected: (ids: string[]) => Promise<void>;
  saving: boolean;
};

const confidenceLabel: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export function AiImportReviewTable({
  rows,
  clients,
  helpers,
  formTemplate,
  onRowChange,
  onSaveSelected,
  saving,
}: AiImportReviewTableProps) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const reviewRow = rows.find((row) => row.id === reviewId);
  const reviewStart = reviewRow ? new Date(`${reviewRow.date}T${reviewRow.startAt}:00`) : null;
  const reviewEnd = reviewRow ? new Date(`${reviewRow.date}T${reviewRow.endAt}:00`) : null;
  const reviewTravelTime = reviewRow?.travelTime?.trim() ?? '';
  const canConfirmReview = Boolean(
    reviewRow?.result && reviewRow.clientId && reviewRow.helperId &&
    reviewStart && reviewEnd && Number.isFinite(reviewStart.getTime()) &&
    Number.isFinite(reviewEnd.getTime()) && reviewEnd > reviewStart &&
    (!reviewTravelTime || (Number.isFinite(Number(reviewTravelTime)) && Number(reviewTravelTime) >= 0)),
  );
  const confirmedIds = rows
    .filter((r) => r.status === 'confirmed' && r.saveStatus !== 'saved')
    .map((r) => r.id);

  const changeValue = (row: ReviewRow, item: FormItem, value: DynamicFormValue) => {
    if (!row.result) return;
    const values = { ...row.result.values };
    if (item.type === 'number') {
      if (value === '' || typeof value !== 'string' || !Number.isFinite(Number(value))) delete values[item.id];
      else values[item.id] = Number(value);
    } else {
      values[item.id] = value;
    }
    onRowChange(row.id, { result: { ...row.result, values } });
  };

  const changeDetail = (row: ReviewRow, item: FormItem, value: string) => {
    if (!row.result) return;
    const values = { ...row.result.values };
    if (value) values[`${item.id}_detail`] = value;
    else delete values[`${item.id}_detail`];
    onRowChange(row.id, { result: { ...row.result, values } });
  };

  const handleSave = () => {
    void onSaveSelected(confirmedIds);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {rows.length} 件（確認済み: {confirmedIds.length} 件）
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<SaveIcon />}
          disabled={confirmedIds.length === 0 || saving}
          onClick={handleSave}
        >
          選択した記録を下書き保存
        </Button>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>プレビュー</TableCell>
              <TableCell>状態</TableCell>
              <TableCell>日付</TableCell>
              <TableCell>開始</TableCell>
              <TableCell>終了</TableCell>
              <TableCell>移動時間(h)</TableCell>
              <TableCell>利用者</TableCell>
              <TableCell>スタッフ</TableCell>
              <TableCell>AI自己評価</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const isConfirmed = row.status === 'confirmed';
              const isSkipped = row.status === 'skipped';
              const isError = row.status === 'error';
              const warnings = [
                ...(row.errorMessage ? [row.errorMessage] : []),
                ...(row.result?.warnings ?? []),
                ...(row.result && !row.clientId ? ['利用者候補なし'] : []),
                ...(row.result && !row.helperId ? ['スタッフ候補なし'] : []),
              ];
              return (
                <TableRow
                  key={row.id}
                  sx={{
                    opacity: isSkipped ? 0.45 : 1,
                    bgcolor: isConfirmed ? 'background.tint' : undefined,
                  }}
                >
                  {/* チェックボックス */}
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={isConfirmed}
                      disabled
                      inputProps={{ 'aria-label': `${row.fileName}の確認状態` }}
                    />
                  </TableCell>

                  {/* プレビュー */}
                  <TableCell>
                    {row.sourceKind === 'ai_chat' ? (
                      <Typography variant="caption" color="warning.main">AI取込<br />原本要確認</Typography>
                    ) : (
                    <Tooltip title={row.fileName || 'アップロードファイル'}>
                      <Box
                        sx={{
                          width: 56,
                          height: 56,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          bgcolor: 'background.default',
                        }}
                      >
                        {row.previewUrl && row.fileType !== 'application/pdf' ? (
                          <Box
                            component="img"
                            src={row.previewUrl}
                            alt={row.fileName}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : row.fileType === 'application/pdf' ? (
                          <PictureAsPdfIcon color="error" />
                        ) : (
                          <ImageIcon color="disabled" />
                        )}
                      </Box>
                    </Tooltip>
                    )}
                    {row.fileCount > 1 && (
                      <Typography variant="caption" color="text.secondary">
                        {row.fileCount}枚
                      </Typography>
                    )}
                  </TableCell>

                  {/* ステータスアイコン */}
                  <TableCell>
                    {row.saveStatus === 'saved' ? (
                      <Tooltip title="保存済み">
                        <CheckCircleIcon color="success" fontSize="small" />
                      </Tooltip>
                    ) : row.saveStatus === 'saving' ? (
                      <Typography variant="caption" color="text.secondary">保存中</Typography>
                    ) : row.saveStatus === 'error' ? (
                      <Tooltip title="保存エラー">
                        <WarningAmberIcon color="error" fontSize="small" />
                      </Tooltip>
                    ) : isError ? (
                      <Tooltip title={row.errorMessage ?? '読み取り失敗'}>
                        <WarningAmberIcon color="error" fontSize="small" />
                      </Tooltip>
                    ) : isConfirmed ? (
                      <Tooltip title="確認済み">
                        <CheckCircleIcon color="primary" fontSize="small" />
                      </Tooltip>
                    ) : isSkipped ? (
                      <Tooltip title="スキップ">
                        <SkipNextIcon color="disabled" fontSize="small" />
                      </Tooltip>
                    ) : (
                      <Tooltip title="要確認">
                        <WarningAmberIcon color="warning" fontSize="small" />
                      </Tooltip>
                    )}
                  </TableCell>

                  {/* 日付 */}
                  <TableCell>
                    <TextField
                      type="date"
                      value={row.date}
                      size="small"
                      disabled={isSkipped || isError || row.saveStatus === 'saved'}
                      onChange={(e) => onRowChange(row.id, { date: e.target.value })}
                      sx={{ width: 140 }}
                      slotProps={{ htmlInput: { style: { padding: '4px 6px' } } }}
                    />
                  </TableCell>

                  {/* 開始時刻 */}
                  <TableCell>
                    <TextField
                      type="time"
                      value={row.startAt}
                      size="small"
                      disabled={isSkipped || isError || row.saveStatus === 'saved'}
                      onChange={(e) => onRowChange(row.id, { startAt: e.target.value })}
                      sx={{ width: 100 }}
                      slotProps={{ htmlInput: { style: { padding: '4px 6px' } } }}
                    />
                  </TableCell>

                  {/* 終了時刻 */}
                  <TableCell>
                    <TextField
                      type="time"
                      value={row.endAt}
                      size="small"
                      disabled={isSkipped || isError || row.saveStatus === 'saved'}
                      onChange={(e) => onRowChange(row.id, { endAt: e.target.value })}
                      sx={{ width: 100 }}
                      slotProps={{ htmlInput: { style: { padding: '4px 6px' } } }}
                    />
                  </TableCell>

                  {/* 移動時間 */}
                  <TableCell>
                    <TextField
                      type="number"
                      value={row.travelTime ?? ''}
                      size="small"
                      disabled={isSkipped || isError || row.saveStatus === 'saved'}
                      onChange={(e) => onRowChange(row.id, { travelTime: e.target.value })}
                      sx={{ width: 90 }}
                      slotProps={{ htmlInput: { min: 0, step: 0.25, style: { padding: '4px 6px' } } }}
                    />
                  </TableCell>

                  {/* 利用者 */}
                  <TableCell>
                    <FormControl size="small" sx={{ minWidth: 130 }}>
                      <Select
                        value={row.clientId ?? ''}
                        displayEmpty
                        disabled={isSkipped || isError || row.saveStatus === 'saved'}
                        onChange={(e) =>
                          onRowChange(row.id, { clientId: e.target.value || null })
                        }
                        renderValue={(val) =>
                          val
                            ? (clients.find((c) => c.id === val)?.name ?? val)
                            : <Typography component="span" color="text.disabled">未選択</Typography>
                        }
                      >
                        <MenuItem value=""><em>未選択</em></MenuItem>
                        {clients.map((c) => (
                          <MenuItem key={c.id} value={c.id}>
                            {c.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>

                  {/* スタッフ */}
                  <TableCell>
                    <FormControl size="small" sx={{ minWidth: 130 }}>
                      <Select
                        value={row.helperId ?? ''}
                        displayEmpty
                        disabled={isSkipped || isError || row.saveStatus === 'saved'}
                        onChange={(e) =>
                          onRowChange(row.id, { helperId: e.target.value || null })
                        }
                        renderValue={(val) =>
                          val
                            ? (helpers.find((h) => h.id === val)?.name ?? val)
                            : <Typography component="span" color="text.disabled">未選択</Typography>
                        }
                      >
                        <MenuItem value=""><em>未選択</em></MenuItem>
                        {helpers.map((h) => (
                          <MenuItem key={h.id} value={h.id}>
                            {h.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>

                  {/* 信頼度 */}
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {row.result ? (
                        <Chip
                          label={`${confidenceLabel[row.result.confidence] ?? row.result.confidence}（参考）`}
                          color="default"
                          size="small"
                        />
                      ) : (
                        <Chip label="失敗" color="error" size="small" />
                      )}
                      {warnings.length > 0 && (
                        <Tooltip title={warnings.join(' / ')}>
                          <WarningAmberIcon color="warning" fontSize="small" />
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>

                  {/* 操作ボタン */}
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {!isSkipped && !isError && row.saveStatus !== 'saved' && (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => setReviewId(row.id)}
                        >
                          内容を確認・修正
                        </Button>
                      )}
                      {!isSkipped && row.saveStatus !== 'saved' && (
                        <IconButton
                          size="small"
                          title={row.sourceKind === 'ai_chat' ? '候補を破棄' : 'スキップ'}
                          onClick={() =>
                            onRowChange(row.id, { status: 'skipped' })
                          }
                        >
                          <SkipNextIcon fontSize="small" />
                        </IconButton>
                      )}
                      {isSkipped && (
                        <Button
                          size="small"
                          onClick={() =>
                            onRowChange(row.id, { status: 'pending' })
                          }
                        >
                          戻す
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={Boolean(reviewRow)} onClose={() => setReviewId(null)} maxWidth="lg" fullWidth>
        <DialogTitle>原本と抽出内容を確認</DialogTitle>
        <DialogContent dividers>
          {reviewRow?.result && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2 }}>
              <Box>
                <Typography variant="subtitle2" gutterBottom>{reviewRow.fileName}</Typography>
                {reviewRow.sourceKind === 'ai_chat' && (
                  <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
                    AIチャットで読み取った候補です。原本PDFはこの画面に保存されていません。AIチャット側の原本と、日付・丸印・特記事項を照合してください。
                  </Typography>
                )}
                {(reviewRow.sourceFiles ?? [{ fileName: reviewRow.fileName, fileType: reviewRow.fileType, previewUrl: reviewRow.previewUrl }]).map((source, index) => (
                  <Box key={`${source.fileName}-${index}`} sx={{ mb: 2 }}>
                    {reviewRow.fileCount > 1 && <Typography variant="caption">{index + 1}枚目: {source.fileName}</Typography>}
                    {source.previewUrl && (source.fileType === 'application/pdf' ? (
                      <Box component="iframe" src={source.previewUrl} title={source.fileName} sx={{ width: '100%', height: 560, border: 1, borderColor: 'divider' }} />
                    ) : (
                      <Box component="img" src={source.previewUrl} alt={source.fileName} sx={{ width: '100%', maxHeight: 560, objectFit: 'contain' }} />
                    ))}
                  </Box>
                ))}
              </Box>
              <Box sx={{ maxHeight: 600, overflowY: 'auto', pr: 1 }}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  記録日時: {reviewRow.date || '未入力'} {reviewRow.startAt || '未入力'}〜{reviewRow.endAt || '未入力'}
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>移動時間: {reviewRow.travelTime || '未入力'} 時間</Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  利用者: {clients.find((candidate) => candidate.id === reviewRow.clientId)?.name ?? '未選択'} ／
                  スタッフ: {helpers.find((candidate) => candidate.id === reviewRow.helperId)?.name ?? '未選択'}
                </Typography>
                {reviewRow.result.warnings.length > 0 && (
                  <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
                    要確認: {reviewRow.result.warnings.join(' / ')}
                  </Typography>
                )}
                {formTemplate.filter((item) => item.type !== 'section').map((item) => (
                  <Box key={item.id} sx={{ mb: 2, p: 1.5, border: 1, borderColor: item.id in reviewRow.result!.values ? 'divider' : 'warning.light', borderRadius: 1 }}>
                    <DynamicFormField
                      item={item}
                      value={reviewRow.result!.values[item.id]}
                      detailValue={String(reviewRow.result!.values[`${item.id}_detail`] ?? '')}
                      onChange={(value) => changeValue(reviewRow, item, value)}
                      onDetailChange={(value) => changeDetail(reviewRow, item, value)}
                    />
                    {!(item.id in reviewRow.result!.values) && <Typography variant="caption" color="warning.main">AIが確定できなかった項目です</Typography>}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {!canConfirmReview && <Typography variant="caption" color="error">利用者・スタッフ・日時・移動時間を確認してください</Typography>}
          <Button onClick={() => setReviewId(null)}>閉じる</Button>
          <Button variant="contained" disabled={!canConfirmReview} onClick={() => {
            if (reviewRow) onRowChange(reviewRow.id, { status: 'confirmed' });
            setReviewId(null);
          }}>原本と照合して確認済みにする</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
