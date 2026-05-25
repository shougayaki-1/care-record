'use client';

import React from 'react';
import {
    Box, Paper, Typography, TextField, Checkbox, FormControlLabel, Radio, RadioGroup,
    Stack, FormGroup, Switch, FormHelperText, Divider
} from '@mui/material';
import { FormItem } from '@/types';

type FormAnswers = Record<string, string | number | boolean | string[]>;

type Props = {
    groupedSections: { title: string; items: FormItem[] }[];
    answers: FormAnswers;
    handleAnswerChange: (id: string, value: string | number | boolean | string[]) => void;
    errors: Record<string, string>;
};

export function RecordForm({ groupedSections, answers, handleAnswerChange, errors }: Props) {
    return (
        <Stack spacing={4}>
            {groupedSections.map((section, idx) => (
                <Paper key={idx} variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: '#fff' }}>
                    <Box sx={{ bgcolor: '#f8f9fa', px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
                        <Box sx={{ width: 6, height: 28, bgcolor: 'primary.main', borderRadius: 1, mr: 2, flexShrink: 0 }} />
                        <Typography variant="h6" color="text.primary" fontWeight="bold">{section.title}</Typography>
                    </Box>
                    <Stack divider={<Divider />}>
                        {section.items.map((item) => {
                            const hasError = !!errors[item.id];
                            return (
                                <Box key={item.id} sx={{ p: 3, bgcolor: hasError ? '#fff5f5' : 'transparent' }}>
                                    {item.type === 'checkbox' && (
                                        <Box display="flex" flexDirection="column" gap={1}>
                                            <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                                                <Typography variant="subtitle1" fontWeight={answers[item.id] ? "bold" : "normal"} color={answers[item.id] ? "primary.main" : "text.primary"} onClick={() => handleAnswerChange(item.id, !answers[item.id])} sx={{ cursor: 'pointer', flex: 1 }}>{item.label}</Typography>
                                                <Switch checked={!!answers[item.id]} onChange={e => handleAnswerChange(item.id, e.target.checked)} color="primary" />
                                            </Box>
                                            {item.hasDetail && answers[item.id] && (
                                                <TextField placeholder="詳細..." fullWidth size="small" value={(answers[`${item.id}_detail`] as string) || ''} onChange={e => handleAnswerChange(`${item.id}_detail`, e.target.value)} sx={{ mt: 1 }} />
                                            )}
                                        </Box>
                                    )}
                                    {['text', 'number', 'time'].includes(item.type) && (
                                        <Box>
                                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{item.label} {item.required && <Typography component="span" color="error">*</Typography>}</Typography>
                                            <TextField fullWidth variant="outlined" type={item.type === 'number' ? 'number' : 'text'} multiline={item.type === 'text'} minRows={item.type === 'text' ? 3 : 1} value={(answers[item.id] as string) || ''} onChange={e => handleAnswerChange(item.id, e.target.value)} error={hasError} helperText={errors[item.id]} placeholder={`${item.label}を入力`} />
                                        </Box>
                                    )}
                                    {item.type === 'multicheckbox' && (
                                        <Box>
                                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1.5, display: 'block' }}>{item.label} {item.required && <Typography component="span" color="error">*</Typography>}</Typography>
                                            <FormGroup row sx={{ gap: 1 }}>
                                                {item.options?.split(',').map((opt: string) => (
                                                    <FormControlLabel key={opt} sx={{ mr: 2, mb: 1, border: '1px solid', borderRadius: 2, px: 1.5, py: 0.5, mx: 0, '&:hover': { bgcolor: '#f5f5f5' }, bgcolor: ((answers[item.id] as string[]) || []).includes(opt.trim()) ? '#eef2ff' : 'transparent', borderColor: ((answers[item.id] as string[]) || []).includes(opt.trim()) ? 'primary.main' : 'divider' }} control={<Checkbox size="small" checked={((answers[item.id] as string[]) || []).includes(opt.trim())} onChange={e => { const current = (answers[item.id] as string[]) || []; const next = e.target.checked ? [...current, opt.trim()] : current.filter((v: string) => v !== opt.trim()); handleAnswerChange(item.id, next); }} />} label={<Typography variant="body2" fontWeight={((answers[item.id] as string[]) || []).includes(opt.trim()) ? 'bold' : 'normal'}>{opt.trim()}</Typography>} />
                                                ))}
                                            </FormGroup>
                                            {item.hasDetail && String(answers[item.id] || '').includes('他') && (
                                                <TextField placeholder="その他の詳細..." fullWidth size="small" sx={{ mt: 1 }} value={(answers[`${item.id}_detail`] as string) || ''} onChange={e => handleAnswerChange(`${item.id}_detail`, e.target.value)} />
                                            )}
                                            {hasError && <FormHelperText error>{errors[item.id]}</FormHelperText>}
                                        </Box>
                                    )}
                                    {item.type === 'select' && (
                                        <Box>
                                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1.5, display: 'block' }}>{item.label} {item.required && <Typography component="span" color="error">*</Typography>}</Typography>
                                            <RadioGroup row value={(answers[item.id] as string) || ''} onChange={e => handleAnswerChange(item.id, e.target.value)}>
                                                {item.options?.split(',').map((opt: string) => (
                                                    <FormControlLabel key={opt} value={opt.trim()} control={<Radio size="small" />} label={<Typography variant="body2">{opt.trim()}</Typography>} sx={{ mr: 3 }} />
                                                ))}
                                            </RadioGroup>
                                            {item.hasDetail && (answers[item.id] === 'その他' || String(answers[item.id]).includes('他')) && (
                                                <TextField placeholder="詳細..." fullWidth size="small" sx={{ mt: 1 }} value={(answers[`${item.id}_detail`] as string) || ''} onChange={e => handleAnswerChange(`${item.id}_detail`, e.target.value)} />
                                            )}
                                            {hasError && <FormHelperText error>{errors[item.id]}</FormHelperText>}
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}
                    </Stack>
                </Paper>
            ))}
        </Stack>
    );
}