'use client';

import { useState } from 'react';

import AddCircleIcon from '@mui/icons-material/AddCircle';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CommentIcon from '@mui/icons-material/Comment';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import TitleIcon from '@mui/icons-material/Title';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import type { FormItem } from '@/constants/formTemplates';
import { DynamicFormField, type DynamicFormValue } from '@/components/ui/DynamicFormField';
import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@/components/ui/mui';

type Props = {
  formItems: FormItem[];
  onOpenCopy: () => void;
  onAddField: (index: number) => string;
  onRemoveField: (index: number) => void;
  onUpdateField: (index: number, key: keyof FormItem, value: FormItem[keyof FormItem]) => void;
  onMoveField: (index: number, direction: 'up' | 'down') => void;
  onMoveFieldTo: (index: number, targetIndex: number) => void;
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
  onRemoveField,
  onUpdateField,
  onMoveField,
  onMoveFieldTo,
  getOptions,
  onUpdateOption,
  onAddOption,
  onRemoveOption,
  onMoveOption,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, DynamicFormValue>>({});
  const [previewDetails, setPreviewDetails] = useState<Record<string, string>>({});
  const addAt = (index: number) => setExpandedId(onAddField(index));
  const typeLabel = (type: FormItem['type']) => ({
    section: '見出し', checkbox: '実施した／していない', multicheckbox: '複数選ぶ',
    text: '文章で書く', number: '数値を入れる', select: '1つ選ぶ', time: '時刻を入れる',
  })[type];
  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" gap={1} mb={2} sx={{ flexWrap: 'wrap', '& > *': { width: { xs: '100%', sm: 'auto' } } }}>
        <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={onOpenCopy}>
          テンプレート読込 / コピー
        </Button>
      </Box>
      <Stack spacing={1} pb={2}>
        {formItems.map((item, index) => (
          <Box key={item.id}>
          <Card sx={{ overflow: 'visible', borderLeft: item.type === 'section' ? '6px solid' : 'none', borderLeftColor: 'primary.main', bgcolor: item.type === 'section' ? 'background.tint' : 'background.paper' }}>
            <CardContent sx={{ p: '16px !important' }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Button onClick={() => setExpandedId(expandedId === item.id ? null : item.id)} aria-expanded={expandedId === item.id} endIcon={<ExpandMoreIcon sx={{ transform: expandedId === item.id ? 'rotate(180deg)' : undefined }} />} sx={{ flexGrow: 1, justifyContent: 'space-between', textAlign: 'left', minWidth: 0, textTransform: 'none' }}>
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label || '新しい設問'} · {typeLabel(item.type)}</Box>
                </Button>
                <IconButton size="small" aria-label={`${item.label || '設問'}を上へ`} onClick={() => onMoveField(index, 'up')} disabled={index === 0}><ArrowUpwardIcon fontSize="small" /></IconButton>
                <IconButton size="small" aria-label={`${item.label || '設問'}を下へ`} onClick={() => onMoveField(index, 'down')} disabled={index === formItems.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton>
              </Stack>
              <Collapse in={expandedId === item.id} unmountOnExit>
              <Stack direction={{ xs: 'column', md: 'row' }} alignItems="flex-start" spacing={2}>
                <Stack direction={{ xs: 'row', md: 'column' }} spacing={0.5} sx={{ width: { xs: '100%', md: 'auto' }, justifyContent: { xs: 'space-between', md: 'flex-start' } }}>
                  <IconButton color="error" size="small" aria-label="設問を削除" onClick={() => onRemoveField(index)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
                <Box sx={{ flexGrow: 1, width: '100%' }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={1}>
                    <TextField select label="回答方法" size="small" value={item.type} onChange={(event) => { const nextType = event.target.value as FormItem['type']; onUpdateField(index, 'type', nextType); onUpdateField(index, 'detailMode', nextType === 'number' ? 'always' : 'conditional'); }} sx={{ width: { xs: '100%', md: 'auto' }, minWidth: { md: 180 } }} slotProps={{ input: { startAdornment: item.type === 'section' ? <TitleIcon sx={{ mr: 1, color: 'primary.main' }} /> : null } }}>
                      <MenuItem value="section" sx={{ fontWeight: 'bold', color: 'primary.main' }}>見出し</MenuItem>
                      <Divider />
                      <MenuItem value="checkbox">実施した／していない</MenuItem>
                      <MenuItem value="multicheckbox">複数選ぶ</MenuItem>
                      <MenuItem value="text">文章で書く</MenuItem>
                      <MenuItem value="number">数値を入れる</MenuItem>
                      <MenuItem value="select">1つ選ぶ</MenuItem>
                      <MenuItem value="time">時刻を入れる</MenuItem>
                    </TextField>
                    <TextField label={item.type === 'section' ? 'セクション名' : '質問内容'} size="small" fullWidth value={item.label} onChange={(event) => onUpdateField(index, 'label', event.target.value)} sx={{ '& .MuiInputBase-input': { fontWeight: item.type === 'section' ? 'bold' : 'normal', fontSize: item.type === 'section' ? '1.1rem' : '1rem' } }} />
                    {item.type !== 'section' && <FormControlLabel control={<Switch size="small" checked={item.required} onChange={(event) => onUpdateField(index, 'required', event.target.checked)} />} label="回答を必須にする" sx={{ minWidth: 150, alignSelf: { xs: 'flex-start', md: 'center' } }} />}
                  </Stack>
                  {(item.type === 'checkbox' || item.type === 'multicheckbox' || item.type === 'select' || item.type === 'number') && (
                      <Box><FormControlLabel control={<Switch size="small" color="secondary" checked={!!item.hasDetail} onChange={(event) => { onUpdateField(index, 'hasDetail', event.target.checked); if (item.type === 'number') onUpdateField(index, 'detailMode', 'always'); }} />} label={<Box display="flex" alignItems="center" gap={0.5}><CommentIcon fontSize="small" color="action" />補足欄を表示する</Box>} sx={{ mb: 0.5, ml: { xs: 0, sm: 1 } }} />
                      {item.hasDetail && <Typography variant="caption" color="text.secondary" display="block">{item.detailMode === 'always' || item.type === 'number' ? '回答の下に常に表示' : item.type === 'checkbox' ? '「実施した」を選んだ時に表示' : '「他」を含む選択肢を選んだ時に表示'}</Typography>}</Box>
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
                  {formItems.length > 1 && <TextField select size="small" label="移動先" value="" onChange={(event) => onMoveFieldTo(index, Number(event.target.value))} sx={{ mt: 2, minWidth: 220 }}>
                    <MenuItem value="" disabled>選択してください</MenuItem>
                    {formItems.map((target, targetIndex) => targetIndex !== index && <MenuItem key={target.id} value={targetIndex}>{targetIndex + 1}番目</MenuItem>)}
                  </TextField>}
                  <Box sx={{ mt: 2 }}>
                    <Button size="small" onClick={() => setPreviewId(previewId === item.id ? null : item.id)}>入力画面の表示例</Button>
                    <Collapse in={previewId === item.id} unmountOnExit>
                      <Box sx={{ p: 2, mt: 1, bgcolor: 'background.muted', borderRadius: 1 }}>
                        {item.type === 'section' ? <Typography variant="h6">{item.label || '見出し'}</Typography> : <DynamicFormField item={item} value={previewAnswers[item.id]} detailValue={previewDetails[item.id] ?? ''} onChange={(value) => setPreviewAnswers((previous) => ({ ...previous, [item.id]: value }))} onDetailChange={(value) => setPreviewDetails((previous) => ({ ...previous, [item.id]: value }))} />}
                      </Box>
                    </Collapse>
                  </Box>
                </Box>
              </Stack>
              </Collapse>
            </CardContent>
          </Card>
          <Button size="small" startIcon={<AddCircleIcon />} onClick={() => addAt(index + 1)} sx={{ ml: 2, my: 0.5 }}>下に追加</Button>
          </Box>
        ))}
        {formItems.length === 0 && <Button variant="outlined" startIcon={<AddCircleIcon />} onClick={() => addAt(0)}>最初の設問を追加</Button>}
      </Stack>
    </Box>
  );
}
