// app/helper/record/[clientId]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  Box, Button, Container, Typography, TextField, Checkbox, FormControlLabel, Radio, RadioGroup,
  FormControl, FormLabel, Paper, Stack, Divider, AppBar, Toolbar, IconButton, CircularProgress,
  FormGroup, Switch, Autocomplete, Chip, InputAdornment, FormHelperText
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';

type FormItem = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string;
  required: boolean;
  hasDetail?: boolean;
};

export default function RecordPage() {
  const router = useRouter();
  const { clientId } = useParams();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const reportId = searchParams.get('reportId');

  const [clientName, setClientName] = useState('');
  const [template, setTemplate] = useState<FormItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [allHelpers, setAllHelpers] = useState<{ id: string, name: string }[]>([]);
  const [selectedHelpers, setSelectedHelpers] = useState<string[]>([]);

  const [startDateTime, setStartDateTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [serviceTime, setServiceTime] = useState('');
  const [travelTime, setTravelTime] = useState('0');

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // 日時フォーマット関数 (YYYY-MM-DDThh:mm)
  const formatDatetimeLocal = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  useEffect(() => {
    const init = async () => {
      if (!reportId) {
        const now = new Date();
        setStartDateTime(formatDatetimeLocal(now));
        setEndDateTime(formatDatetimeLocal(new Date(now.getTime() + 3600000)));
      }
      await fetchBaseData();
      if (reportId) await loadExistingData();
      setLoading(false);
    };
    init();
  }, [reportId]);

  const fetchBaseData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();

    if (client) {
      setClientName(client.name);
      const { data: tmpl } = await supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle();
      if (tmpl?.schema) {
        setTemplate((tmpl.schema as FormItem[]).filter(i => i.id !== 'service_time' && i.id !== 'travel_time'));
      }
      const { data: profiles } = await supabase.from('profiles').select('id, name').eq('organization_id', client.organization_id);
      if (profiles) setAllHelpers(profiles);
      if (!reportId && user) {
        const me = profiles?.find(p => p.id === user.id);
        if (me) setSelectedHelpers([me.name]);
      }
    }
  };

  const loadExistingData = async () => {
    try {
      const { data: r } = await supabase.from('reports').select('*').eq('id', reportId).single();
      const { data: v } = await supabase.from('report_values').select('data').eq('report_id', reportId).single();
      if (r && v) {
        setStartDateTime(r.start_at.slice(0, 16));
        setEndDateTime(r.end_at.slice(0, 16));
        setServiceTime(v.data.service_time || '');
        setTravelTime(v.data.travel_time || '0');
        setSelectedHelpers(v.data._helpers || []);
        setAnswers(v.data);
      }
    } catch (e) { console.error(e); }
  };

  const handleAnswerChange = (id: string, value: any) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
    if (errors[id]) {
      const ne = { ...errors }; delete ne[id]; setErrors(ne);
    }
  };

  const validate = () => {
    const ne: Record<string, string> = {};
    if (!serviceTime) ne['serviceTime'] = '必須項目です';
    if (selectedHelpers.length === 0) ne['helpers'] = '選択必須です';
    template.forEach(item => {
      if (item.required && (!answers[item.id] || (Array.isArray(answers[item.id]) && answers[item.id].length === 0))) {
        ne[item.id] = '必須項目です';
      }
    });
    setErrors(ne);
    return Object.keys(ne).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      showToast('入力不備があります', 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const finalData = { ...answers, _helpers: selectedHelpers, service_time: serviceTime, travel_time: travelTime };
      const payload = {
        client_id: clientId,
        helper_id: user?.id,
        start_at: new Date(startDateTime).toISOString(),
        end_at: new Date(endDateTime).toISOString(),
        status: 'pending' as const
      };
      if (reportId) {
        await supabase.from('reports').update(payload).eq('id', reportId);
        await supabase.from('report_values').update({ data: finalData }).eq('report_id', reportId);
        showToast('記録を更新しました');
      } else {
        const { data: nr } = await supabase.from('reports').insert(payload).select().single();
        if (nr) await supabase.from('report_values').insert({ report_id: nr.id, data: finalData });
        showToast('記録を送信しました');
      }
      router.push('/helper');
    } catch (e) {
      showToast('エラーが発生しました', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Box sx={{ textAlign: 'center', p: 10 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ pb: 10 }}>
      <AppBar position="fixed" elevation={0} sx={{ bgcolor: '#fff', color: '#333', borderBottom: '1px solid #e0e0e0', zIndex: 1100 }}>
        <Container maxWidth="md">
          <Toolbar disableGutters>
            <IconButton edge="start" onClick={() => router.back()} sx={{ mr: 1 }}><CloseIcon /></IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 900 }}>{reportId ? '記録を修正' : `${clientName} 様`}</Typography>
            <Button variant="contained" size="small" startIcon={<SendIcon />} onClick={handleSubmit} disabled={submitting} sx={{ borderRadius: 4, fontWeight: 'bold' }}>
              {reportId ? '更新' : '送信'}
            </Button>
          </Toolbar>
        </Container>
      </AppBar>
      <Toolbar />

      <Container maxWidth="md" sx={{ mt: 3 }}>
        {/* CSS Gridを使用したレスポンシブな配置 */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2
        }}>

          {/* 基本設定エリア（常に全幅） */}
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Paper variant="outlined" sx={{ p: 3, borderRadius: 4, bgcolor: '#f8f9fa' }}>
              <Stack spacing={3}>
                <Box>
                  <Typography variant="subtitle2" fontWeight="bold" gutterBottom color={errors.helpers ? 'error' : 'inherit'}>担当ヘルパー</Typography>
                  <Autocomplete
                    multiple freeSolo options={allHelpers.map(h => h.name)}
                    value={selectedHelpers} onChange={(_, v) => setSelectedHelpers(v as string[])}
                    renderInput={(params) => <TextField {...params} variant="standard" placeholder="名前を入力" error={!!errors.helpers} />}
                  />
                </Box>
                <Divider />
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                  <TextField label="開始日時" type="datetime-local" fullWidth InputLabelProps={{ shrink: true }} value={startDateTime} onChange={e => setStartDateTime(e.target.value)} />
                  <TextField label="終了日時" type="datetime-local" fullWidth InputLabelProps={{ shrink: true }} value={endDateTime} onChange={e => setEndDateTime(e.target.value)} />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField label="サービス(h)" type="number" fullWidth value={serviceTime} onChange={e => setServiceTime(e.target.value)} error={!!errors.serviceTime} inputProps={{ inputMode: 'decimal', step: '0.5' }} />
                  <TextField label="移動(h)" type="number" fullWidth value={travelTime} onChange={e => setTravelTime(e.target.value)} inputProps={{ inputMode: 'decimal', step: '0.5' }} />
                </Box>
              </Stack>
            </Paper>
          </Box>

          {/* テンプレート項目 */}
          {template.map((item) => {
            if (item.type === 'section') {
              return (
                <Box key={item.id} sx={{ gridColumn: '1 / -1', mt: 2 }}>
                  <Typography variant="h6" sx={{ color: '#2255CC', fontWeight: 900, borderBottom: '2.5px solid #2255CC', pb: 0.5 }}>
                    {item.label}
                  </Typography>
                </Box>
              );
            }

            const hasError = !!errors[item.id];
            // テキスト入力（長文）やマルチチェックは全幅
            const isWide = ['multicheckbox', 'text'].includes(item.type);

            return (
              <Box key={item.id} sx={{ gridColumn: isWide ? '1 / -1' : 'span 1' }}>
                <Paper variant="outlined" sx={{
                  p: 2, borderRadius: 3, height: '100%',
                  borderColor: hasError ? 'error.main' : (answers[item.id] ? 'primary.main' : '#e0e0e0'),
                  borderWidth: (answers[item.id] || hasError) ? 2 : 1
                }}>
                  <Stack spacing={1.5}>
                    {item.type !== 'checkbox' && (
                      <Typography variant="subtitle2" fontWeight="bold" color={hasError ? 'error' : 'inherit'}>
                        {item.label} {item.required && <span style={{ color: '#ef4444' }}>*</span>}
                      </Typography>
                    )}

                    {item.type === 'checkbox' && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography fontWeight="bold" color={hasError ? 'error' : 'inherit'}>{item.label}</Typography>
                        <Switch checked={!!answers[item.id]} onChange={e => handleAnswerChange(item.id, e.target.checked)} />
                      </Box>
                    )}

                    {['text', 'number', 'time'].includes(item.type) && (
                      <TextField
                        fullWidth variant="outlined" size="small"
                        type={item.type === 'number' ? 'number' : 'text'}
                        multiline={item.type === 'text'} rows={item.type === 'text' ? 3 : 1}
                        value={answers[item.id] || ''} onChange={e => handleAnswerChange(item.id, e.target.value)}
                        error={hasError} helperText={errors[item.id]}
                        inputProps={item.type === 'number' ? { inputMode: 'decimal' } : {}}
                      />
                    )}

                    {item.type === 'multicheckbox' && (
                      <FormControl error={hasError} fullWidth>
                        <FormGroup row>
                          {item.options?.split(',').map((opt: string) => (
                            <FormControlLabel
                              key={opt} sx={{ width: { xs: '50%', sm: '33%', md: '25%' }, mr: 0 }}
                              control={
                                <Checkbox
                                  size="small" checked={(answers[item.id] || []).includes(opt.trim())}
                                  onChange={e => {
                                    const current = answers[item.id] || [];
                                    const next = e.target.checked ? [...current, opt.trim()] : current.filter((v: string) => v !== opt.trim());
                                    handleAnswerChange(item.id, next);
                                  }}
                                />
                              }
                              label={<Typography variant="body2">{opt.trim()}</Typography>}
                            />
                          ))}
                        </FormGroup>
                        {hasError && <FormHelperText>{errors[item.id]}</FormHelperText>}
                      </FormControl>
                    )}

                    {item.type === 'select' && (
                      <FormControl error={hasError} fullWidth>
                        <RadioGroup row value={answers[item.id] || ''} onChange={e => handleAnswerChange(item.id, e.target.value)}>
                          {item.options?.split(',').map((opt: string) => (
                            <FormControlLabel key={opt} value={opt.trim()} control={<Radio size="small" />} label={<Typography variant="body2">{opt.trim()}</Typography>} />
                          ))}
                        </RadioGroup>
                        {hasError && <FormHelperText>{errors[item.id]}</FormHelperText>}
                      </FormControl>
                    )}

                    {item.hasDetail && (
                      (item.type === 'checkbox' && answers[item.id]) ||
                      (item.type !== 'checkbox' && String(answers[item.id] || '').includes('他'))
                    ) && (
                        <TextField
                          placeholder="詳細を入力" fullWidth variant="filled" size="small"
                          value={answers[`${item.id}_detail`] || ''}
                          onChange={e => handleAnswerChange(`${item.id}_detail`, e.target.value)}
                          sx={{ mt: 1, bgcolor: '#f0f0f0', borderRadius: 1 }}
                        />
                      )}
                  </Stack>
                </Paper>
              </Box>
            );
          })}
        </Box>
      </Container>
    </Box>
  );
}