'use client';

import {
  Box,
  Button,
  Checkbox,
  Chip,
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
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SaveIcon from '@mui/icons-material/Save';
import type { ExtractionResult } from '@/lib/ai/extractSchema';

export type ReviewRow = {
  id: string;
  fileIndex: number;
  result: ExtractionResult;
  date: string;
  startAt: string;
  endAt: string;
  clientId: string | null;
  helperId: string | null;
  status: 'pending' | 'confirmed' | 'skipped';
  saveStatus?: 'saving' | 'saved' | 'error';
};

export type AiImportReviewTableProps = {
  rows: ReviewRow[];
  clients: { id: string; name: string }[];
  helpers: { id: string; name: string }[];
  onRowChange: (id: string, changes: Partial<ReviewRow>) => void;
  onSaveSelected: (ids: string[]) => Promise<void>;
  saving: boolean;
};

const confidenceLabel: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const confidenceColor: Record<string, 'success' | 'warning' | 'error'> = {
  high: 'success',
  medium: 'warning',
  low: 'error',
};

export function AiImportReviewTable({
  rows,
  clients,
  helpers,
  onRowChange,
  onSaveSelected,
  saving,
}: AiImportReviewTableProps) {
  const confirmedIds = rows
    .filter((r) => r.status === 'confirmed')
    .map((r) => r.id);

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
              <TableCell>状態</TableCell>
              <TableCell>日付</TableCell>
              <TableCell>開始</TableCell>
              <TableCell>終了</TableCell>
              <TableCell>利用者</TableCell>
              <TableCell>スタッフ</TableCell>
              <TableCell>信頼度</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const isConfirmed = row.status === 'confirmed';
              const isSkipped = row.status === 'skipped';
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
                      disabled={isSkipped || row.saveStatus === 'saved'}
                      onChange={(e) =>
                        onRowChange(row.id, {
                          status: e.target.checked ? 'confirmed' : 'pending',
                        })
                      }
                    />
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
                      disabled={isSkipped || row.saveStatus === 'saved'}
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
                      disabled={isSkipped || row.saveStatus === 'saved'}
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
                      disabled={isSkipped || row.saveStatus === 'saved'}
                      onChange={(e) => onRowChange(row.id, { endAt: e.target.value })}
                      sx={{ width: 100 }}
                      slotProps={{ htmlInput: { style: { padding: '4px 6px' } } }}
                    />
                  </TableCell>

                  {/* 利用者 */}
                  <TableCell>
                    <FormControl size="small" sx={{ minWidth: 130 }}>
                      <Select
                        value={row.clientId ?? ''}
                        displayEmpty
                        disabled={isSkipped || row.saveStatus === 'saved'}
                        onChange={(e) =>
                          onRowChange(row.id, { clientId: e.target.value || null })
                        }
                        renderValue={(val) =>
                          val
                            ? (clients.find((c) => c.id === val)?.name ?? val)
                            : <span style={{ color: '#999' }}>未選択</span>
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
                        disabled={isSkipped || row.saveStatus === 'saved'}
                        onChange={(e) =>
                          onRowChange(row.id, { helperId: e.target.value || null })
                        }
                        renderValue={(val) =>
                          val
                            ? (helpers.find((h) => h.id === val)?.name ?? val)
                            : <span style={{ color: '#999' }}>未選択</span>
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
                    <Chip
                      label={confidenceLabel[row.result.confidence] ?? row.result.confidence}
                      color={confidenceColor[row.result.confidence] ?? 'default'}
                      size="small"
                    />
                  </TableCell>

                  {/* 操作ボタン */}
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {!isConfirmed && !isSkipped && row.saveStatus !== 'saved' && (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() =>
                            onRowChange(row.id, { status: 'confirmed' })
                          }
                        >
                          確認済みに
                        </Button>
                      )}
                      {!isSkipped && row.saveStatus !== 'saved' && (
                        <IconButton
                          size="small"
                          title="スキップ"
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
    </Box>
  );
}
