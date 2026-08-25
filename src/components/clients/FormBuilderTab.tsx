'use client';

import AddCircleIcon from '@mui/icons-material/AddCircle';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CommentIcon from '@mui/icons-material/Comment';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import TitleIcon from '@mui/icons-material/Title';

import type { FormItem } from '@/constants/formTemplates';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@/components/ui/mui';
import { AppTextField } from '@/components/ui/Fields';
import { RadioGroupField } from '@/components/ui/SelectionFields';

const DETAIL_MODE_OPTIONS: { value: 'conditional' | 'always'; label: string }[] = [
  { value: 'conditional', label: '回答したときに表示' },
  { value: 'always', label: '常に表示' },
];

type Props = {
  formItems: FormItem[];
  onOpenCopy: () => void;
  onAddField: (insertIndex?: number) => void;
  onOpenPreview?: () => void;
  onRemoveField: (index: number) => void;
  onUpdateField: (index: number, key: keyof FormItem, value: FormItem[keyof FormItem]) => void;
  onMoveField: (index: number, direction: 'up' | 'down') => void;
  getOptions: (options?: string) => string[];
  onUpdateOption: (index: number, optionIndex: number, value: string) => void;
  onAddOption: (index: number) => void;
  onRemoveOption: (index: number, optionIndex: number) => void;
  onMoveOption: (index: number, optionIndex: number, direction: 'up' | 'down') => void;
};

export function FormBuilderTab({
  formItems,
  onOpenCopy,
  onAddField,
  onOpenPreview,
  onRemoveField,
  onUpdateField,
  onMoveField,
  getOptions,
  onUpdateOption,
  onAddOption,
  onRemoveOption,
  onMoveOption,
}: Props) {
  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" gap={1} mb={2} sx={{ flexWrap: 'wrap', '& > *': { width: { xs: '100%', sm: 'auto' } } }}>
        <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={onOpenCopy}>
          テンプレート読込 / コピー
        </Button>
        {onOpenPreview && (
          <Button variant="outlined" onClick={onOpenPreview}>
            プレビュー
          </Button>
        )}
      </Box>
      <Stack spacing={2} pb={2}>
        <InsertHereButton onClick={() => onAddField(0)} />
        {formItems.map((item, index) => (
          <Box key={item.id}>
          <Card sx={{ overflow: 'visible', borderLeft: item.type === 'section' ? '6px solid' : 'none', borderLeftColor: 'primary.main', bgcolor: item.type === 'section' ? 'background.tint' : 'background.paper' }}>
            <CardContent sx={{ p: '16px !important' }}>
              <Stack direction={{ xs: 'column', md: 'row' }} alignItems="flex-start" spacing={2}>
                <Stack direction={{ xs: 'row', md: 'column' }} spacing={0.5} sx={{ width: { xs: '100%', md: 'auto' }, justifyContent: { xs: 'space-between', md: 'flex-start' } }}>
                  <IconButton size="small" onClick={() => onMoveField(index, 'up')} disabled={index === 0}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={() => onMoveField(index, 'down')} disabled={index === formItems.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  <IconButton color="error" size="small" onClick={() => onRemoveField(index)} sx={{ mt: { md: 1 } }}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
                <Box sx={{ flexGrow: 1, width: '100%' }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={1}>
                    <TextField select label="種類" size="small" value={item.type} onChange={(event) => onUpdateField(index, 'type', event.target.value as FormItem['type'])} sx={{ width: { xs: '100%', md: 'auto' }, minWidth: { md: 160 } }} slotProps={{ input: { startAdornment: item.type === 'section' ? <TitleIcon sx={{ mr: 1, color: 'primary.main' }} /> : null } }}>
                      <MenuItem value="section" sx={{ fontWeight: 'bold', color: 'primary.main' }}>■ セクション見出し</MenuItem>
                      <Divider />
                      <MenuItem value="checkbox">チェック (ON/OFF)</MenuItem>
                      <MenuItem value="multicheckbox">複数選択</MenuItem>
                      <MenuItem value="text">テキスト入力</MenuItem>
                      <MenuItem value="number">数値入力</MenuItem>
                      <MenuItem value="select">1つ選択 (ラジオ)</MenuItem>
                      <MenuItem value="time">時間</MenuItem>
                    </TextField>
                    <TextField label={item.type === 'section' ? 'セクション名' : '質問内容'} size="small" fullWidth value={item.label} onChange={(event) => onUpdateField(index, 'label', event.target.value)} sx={{ '& .MuiInputBase-input': { fontWeight: item.type === 'section' ? 'bold' : 'normal', fontSize: item.type === 'section' ? '1.1rem' : '1rem' } }} />
                    {item.type !== 'section' && <FormControlLabel control={<Switch size="small" checked={item.required} onChange={(event) => onUpdateField(index, 'required', event.target.checked)} />} label="必須" sx={{ minWidth: 80, alignSelf: { xs: 'flex-start', md: 'center' } }} />}
                  </Stack>
                  {item.type !== 'section' && (
                    <FormControlLabel control={<Switch size="small" color="secondary" checked={!!item.hasDetail} onChange={(event) => onUpdateField(index, 'hasDetail', event.target.checked)} />} label={<Box display="flex" alignItems="center" gap={0.5}><CommentIcon fontSize="small" color="action" />詳細入力を許可</Box>} sx={{ mb: 1, ml: { xs: 0, sm: 1 } }} />
                  )}
                  {item.type !== 'section' && item.hasDetail && (
                    <Box sx={{ mb: 1.5, ml: { xs: 0, sm: 1 }, pl: 1.5, borderLeft: '2px solid', borderColor: 'divider' }}>
                      <RadioGroupField
                        label="表示条件"
                        options={DETAIL_MODE_OPTIONS}
                        value={item.detailMode ?? 'conditional'}
                        onChange={(value) => onUpdateField(index, 'detailMode', value as FormItem['detailMode'])}
                        getOptionLabel={(option) => option.label}
                        getOptionValue={(option) => option.value}
                      />
                      <AppTextField
                        label="詳細欄のラベル"
                        size="small"
                        fullWidth
                        value={item.detailLabel ?? ''}
                        onChange={(event) => onUpdateField(index, 'detailLabel', event.target.value)}
                        placeholder="詳細・補足"
                        sx={{ mt: 1, maxWidth: { md: 320 } }}
                      />
                    </Box>
                  )}
                  {(item.type === 'select' || item.type === 'multicheckbox') && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5} sx={{ mb: 0.75 }}><CheckBoxIcon sx={{ fontSize: 16 }} />選択肢</Typography>
                      <Stack spacing={0.75}>
                        {getOptions(item.options).map((option, optionIndex, options) => (
                          <Stack key={optionIndex} direction="row" spacing={0.5} alignItems="center">
                            <TextField size="small" fullWidth value={option} placeholder={`選択肢 ${optionIndex + 1}`} onChange={(event) => onUpdateOption(index, optionIndex, event.target.value)} />
                            <IconButton size="small" onClick={() => onMoveOption(index, optionIndex, 'up')} disabled={optionIndex === 0}><ArrowUpwardIcon fontSize="small" /></IconButton>
                            <IconButton size="small" onClick={() => onMoveOption(index, optionIndex, 'down')} disabled={optionIndex === options.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton>
                            <IconButton size="small" color="error" onClick={() => onRemoveOption(index, optionIndex)}><DeleteIcon fontSize="small" /></IconButton>
                          </Stack>
                        ))}
                        <Button size="small" startIcon={<AddCircleIcon />} onClick={() => onAddOption(index)} sx={{ alignSelf: 'flex-start' }}>選択肢を追加</Button>
                      </Stack>
                    </Box>
                  )}
                </Box>
              </Stack>
            </CardContent>
          </Card>
          <InsertHereButton onClick={() => onAddField(index + 1)} />
          </Box>
        ))}
        <Button variant="outlined" startIcon={<AddCircleIcon />} onClick={() => onAddField()} size="large" sx={{ border: '2px dashed', borderColor: 'divider', color: 'text.secondary', py: 2 }}>項目を追加する</Button>
      </Stack>
    </Box>
  );
}

function InsertHereButton({ onClick }: { onClick: () => void }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', my: -1 }}>
      <Button
        size="small"
        startIcon={<AddCircleIcon fontSize="small" />}
        onClick={onClick}
        sx={{ color: 'text.secondary', minHeight: 28, py: 0 }}
      >
        ここに項目を追加
      </Button>
    </Box>
  );
}
