'use client';

import { useEffect, useState } from 'react';
import {
  Box, Button, Container, Typography, TextField,
  Checkbox, FormControlLabel, Radio, RadioGroup,
  FormControl, FormLabel, Paper, Stack, Divider,
  AppBar, Toolbar, IconButton, CircularProgress, FormGroup,
  Switch, Autocomplete, Chip, Alert, FormHelperText, InputAdornment
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
  const params = useParams();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const clientId = params.clientId as string;
  const reportId = searchParams.get('reportId');

  const [clientName, setClientName] = useState('');
  const [template, setTemplate] = useState<FormItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [allHelpers, setAllHelpers] = useState<{ id: string, name: string, isAssigned: boolean }[]>([]);
  const [selectedHelpers, setSelectedHelpers] = useState<string[]>([]);

  const [startDateTime, setStartDateTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [serviceTime, setServiceTime] = useState('');
  const [travelTime, setTravelTime] = useState('0');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const formatDatetimeLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  useEffect(() => {
    const init = async () => {
      const now = new Date();
      if (!reportId) {
        setStartDateTime(formatDatetimeLocal(now));
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
        setEndDateTime(formatDatetimeLocal(oneHourLater));
      }
      await fetchData();
      if (reportId) await loadExistingReport();
      setLoading(false);
    };
    init();
  }, [reportId]);


  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: client } = await supabase.from('clients').select('name, organization_id').eq('id', clientId).single();
    if (client) {
      setClientName(client.name);

      const { data: tmpl } = await supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle();
      if (tmpl?.schema) {
        const filteredSchema = (tmpl.schema as FormItem[]).filter(item =>
          item.id !== 'service_time' && item.id !== 'travel_time'
        );
        setTemplate(filteredSchema);
      }

      const { data: profiles } = await supabase.from('profiles').select('id, name').eq('organization_id', client.organization_id);
      const { data: assigns } = await supabase.from('assignments').select('helper_id').eq('client_id', clientId);
      const assignedIds = assigns ? assigns.map((a: any) => a.helper_id) : [];

      if (profiles) {
        const sorted = profiles.map(p => ({
          id: p.id,
          name: p.name,
          isAssigned: assignedIds.includes(p.id)
        })).sort((a, b) => (a.isAssigned === b.isAssigned) ? 0 : a.isAssigned ? -1 : 1);

        setAllHelpers(sorted);
        if (!reportId) {
          const me = sorted.find(p => p.id === user.id);
          if (me) setSelectedHelpers([me.name]);
        }
      }
    }
  };

  const loadExistingReport = async () => {
    try {
      const { data: report, error: rError } = await supabase.from('reports').select('*').eq('id', reportId).single();
      const { data: values, error: vError } = await supabase.from('report_values').select('data').eq('report_id', reportId).single();

      if (rError || vError) throw new Error('Load failed');

      if (report) {
        setStartDateTime(formatDatetimeLocal(new Date(report.start_at)));
        setEndDateTime(formatDatetimeLocal(new Date(report.end_at)));
      }
      if (values && values.data) {
        if (values.data.service_time) setServiceTime(values.data.service_time);
        if (values.data.travel_time) setTravelTime(values.data.travel_time);
        if (values.data._helpers) setSelectedHelpers(values.data._helpers);
        setAnswers(values.data);
      }
    } catch (e) {
      console.error(e);
      showToast('データの読み込みに失敗しました', 'error');
    }
  };

  const handleAnswerChange = (id: string, value: any) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
    if (errors[id]) {
      const newErrors = { ...errors };
      delete newErrors[id];
      setErrors(newErrors);
    }
  };

  const handleMultiCheckboxChange = (itemId: string, option: string, checked: boolean) => {
    setAnswers(prev => {
      const currentList: string[] = prev[itemId] || [];
      const newList = checked
        ? [...currentList, option]
        : currentList.filter(v => v !== option);

      if (errors[itemId] && newList.length > 0) {
        const newErrors = { ...errors };
        delete newErrors[itemId];
        setErrors(newErrors);
      }
      return { ...prev, [itemId]: newList };
    });
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    const newWarnings: string[] = [];

    if (!startDateTime) newErrors['startDateTime'] = '開始日時を入力してください';
    if (!endDateTime) newErrors['endDateTime'] = '終了日時を入力してください';
    if (selectedHelpers.length === 0) newErrors['selectedHelpers'] = 'ヘルパーを選択してください';
    if (!serviceTime) newErrors['serviceTime'] = 'サービス時間を入力してください';

    if (startDateTime && endDateTime) {
      const start = new Date(startDateTime);
      const end = new Date(endDateTime);
      const now = new Date();

      if (start > end) {
        newErrors['endDateTime'] = '終了日時は開始日時より後にしてください';
      }
      if (start > now || end > now) {
        newWarnings.push('未来の日時が設定されています。正しいですか？');
      }
    }

    template.forEach(item => {
      if (item.required) {
        const val = answers[item.id];
        if (item.type === 'checkbox') {
          if (!val) newErrors[item.id] = 'この項目はチェック必須です';
        } else if (item.type === 'multicheckbox') {
          if (!val || !Array.isArray(val) || val.length === 0) {
            newErrors[item.id] = '少なくとも1つ選択してください';
          }
        } else {
          if (!val || String(val).trim() === '') {
            newErrors[item.id] = '必須項目です';
          }
        }
      }
    });

    setErrors(newErrors);
    setWarnings(newWarnings);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (warnings.length > 0) {
      if (!confirm(`${warnings.join('\n')}\n\nこのまま保存しますか？`)) return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const finalData = {
        ...answers,
        _helpers: selectedHelpers,
        service_time: serviceTime,
        travel_time: travelTime
      };

      if (reportId) {
        await supabase.from('reports').update({
          start_at: new Date(startDateTime).toISOString(),
          end_at: new Date(endDateTime).toISOString(),
          status: 'pending',
          approved_by: null,
          approved_at: null
        }).eq('id', reportId);

        await supabase.from('report_values').update({ data: finalData }).eq('report_id', reportId);
        showToast('記録を修正しました', 'success');
      } else {
        const { data: report, error: reportError } = await supabase
          .from('reports')
          .insert({
            client_id: clientId,
            helper_id: user?.id,
            start_at: new Date(startDateTime).toISOString(),
            end_at: new Date(endDateTime).toISOString()
          })
          .select()
          .single();

        if (reportError) throw reportError;
        await supabase.from('report_values').insert({ report_id: report.id, data: finalData });
        showToast('記録を送信しました', 'success');
      }

      router.push(reportId ? '/helper/history' : '/helper');

    } catch (error) {
      console.error(error);
      showToast('送信に失敗しました', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Box p={4} textAlign="center"><CircularProgress /></Box>;

  return (
    <Box sx={{ bgcolor: '#fff', minHeight: '100vh', pb: 10 }}>
      <AppBar position="fixed" color="default" elevation={1} sx={{ bgcolor: '#fff' }}>
        <Toolbar>
          <IconButton edge="start" onClick={() => router.back()}><CloseIcon /></IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1, ml: 1, fontWeight: 'bold' }}>
            {reportId ? '記録の修正' : `${clientName} 様`}
          </Typography>
          <Button
            variant="contained"
            endIcon={<SendIcon />}
            onClick={handleSubmit}
            disabled={submitting}
            sx={{ fontWeight: 'bold' }}
          >
            {reportId ? '更新' : '送信'}
          </Button>
        </Toolbar>
      </AppBar>
      <Toolbar />

      <Container maxWidth="sm" sx={{ mt: 3 }}>

        {Object.keys(errors).length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            入力内容に不備があります。赤字の項目を確認してください。
          </Alert>
        )}

        <Stack spacing={3}>

          <Paper variant="outlined" sx={{ p: 3, bgcolor: '#f8f9fa', borderRadius: 3, borderColor: (errors['startDateTime'] || errors['endDateTime'] || errors['selectedHelpers']) ? 'error.main' : undefined }}>
            <Stack spacing={3}>

              <Box>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom color={errors['selectedHelpers'] ? 'error' : 'textPrimary'}>
                  担当ヘルパー {errors['selectedHelpers'] && <span style={{ fontSize: '0.8em' }}>({errors['selectedHelpers']})</span>}
                </Typography>
                <Autocomplete
                  multiple
                  freeSolo
                  options={allHelpers.map(h => h.name)}
                  value={selectedHelpers}
                  onChange={(event, newValue) => {
                    setSelectedHelpers(newValue);
                    if (newValue.length > 0) {
                      const newErrors = { ...errors }; delete newErrors['selectedHelpers']; setErrors(newErrors);
                    }
                  }}
                  renderTags={(value: readonly string[], getTagProps) =>
                    value.map((option: string, index: number) => {
                      const { key, ...tagProps } = getTagProps({ index });
                      return <Chip variant="outlined" label={option} key={key} {...tagProps} sx={{ bgcolor: '#fff' }} />;
                    })
                  }
                  renderInput={(params) => <TextField {...params} variant="standard" placeholder="選択または入力" error={!!errors['selectedHelpers']} />}
                />
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>サービス提供日時</Typography>
                <Stack spacing={2}>
                  <TextField
                    label="開始"
                    type="datetime-local"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={startDateTime}
                    onChange={(e) => {
                      setStartDateTime(e.target.value);
                      if (e.target.value) { const ne = { ...errors }; delete ne['startDateTime']; setErrors(ne); }
                    }}
                    sx={{ bgcolor: '#fff' }}
                    error={!!errors['startDateTime']}
                    helperText={errors['startDateTime']}
                  />
                  <TextField
                    label="終了"
                    type="datetime-local"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={endDateTime}
                    onChange={(e) => {
                      setEndDateTime(e.target.value);
                      if (e.target.value) { const ne = { ...errors }; delete ne['endDateTime']; setErrors(ne); }
                    }}
                    sx={{ bgcolor: '#fff' }}
                    error={!!errors['endDateTime']}
                    helperText={errors['endDateTime']}
                  />
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>提供時間詳細</Typography>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="サービス時間"
                    type="number"
                    fullWidth
                    required
                    value={serviceTime}
                    onChange={(e) => {
                      setServiceTime(e.target.value);
                      if (e.target.value) { const ne = { ...errors }; delete ne['serviceTime']; setErrors(ne); }
                    }}
                    // スマホで数字キーパッドを出すための設定
                    inputProps={{ inputMode: 'decimal', pattern: '[0-9]*' }}
                    InputProps={{ endAdornment: <Typography variant="caption">h</Typography> }}
                    sx={{ bgcolor: '#fff' }}
                    error={!!errors['serviceTime']}
                    helperText={errors['serviceTime']}
                  />
                  <TextField
                    label="移動時間"
                    type="number"
                    fullWidth
                    value={travelTime}
                    onChange={(e) => setTravelTime(e.target.value)}
                    // スマホで数字キーパッドを出すための設定
                    inputProps={{ inputMode: 'decimal', pattern: '[0-9]*' }}
                    InputProps={{ endAdornment: <Typography variant="caption">h</Typography> }}
                    sx={{ bgcolor: '#fff' }}
                  />
                </Stack>
              </Box>

            </Stack>
          </Paper>

          {template.map((item) => {
            if (item.type === 'section') {
              return (
                <Box key={item.id} sx={{ mt: 2, borderBottom: '3px solid #2255CC', pb: 0.5 }}>
                  <Typography variant="h6" color="primary" fontWeight="bold">{item.label}</Typography>
                </Box>
              );
            }

            const hasError = !!errors[item.id];

            return (
              <Paper
                key={item.id}
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  borderColor: hasError ? 'error.main' : (answers[item.id] ? 'primary.main' : 'divider'),
                  borderWidth: (answers[item.id] || hasError) ? 2 : 1,
                  bgcolor: item.type === 'checkbox' && answers[item.id] ? '#f0f7ff' : '#fff'
                }}
              >
                <Stack spacing={1}>

                  {item.type === 'checkbox' && (
                    <Box display="flex" alignItems="center" justifyContent="space-between">
                      <Box>
                        <Typography fontWeight={answers[item.id] ? 'bold' : 'normal'} color={hasError ? 'error' : 'inherit'}>
                          {item.label} {item.required && <Chip label="必須" size="small" color="error" sx={{ height: 20, fontSize: 10 }} />}
                        </Typography>
                        {hasError && <FormHelperText error>{errors[item.id]}</FormHelperText>}
                      </Box>
                      <Switch
                        checked={!!answers[item.id]}
                        onChange={(e) => handleAnswerChange(item.id, e.target.checked)}
                      />
                    </Box>
                  )}

                  {(item.type === 'text' || item.type === 'number' || item.type === 'time') && (
                    <>
                      <Typography variant="subtitle2" fontWeight="bold" color={hasError ? 'error' : "text.secondary"}>
                        {item.label} {item.required && <Chip label="必須" size="small" color="error" sx={{ height: 20, fontSize: 10 }} />}
                      </Typography>
                      <TextField
                        type={item.type}
                        fullWidth
                        size="small"
                        required={item.required}
                        multiline={item.type === 'text'}
                        rows={item.type === 'text' ? 2 : 1}
                        placeholder={item.required ? '必須入力' : '入力してください'}
                        value={answers[item.id] || ''}
                        onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                        // 数字タイプの場合もキーパッドを表示
                        inputProps={item.type === 'number' ? { inputMode: 'decimal', pattern: '[0-9]*' } : undefined}
                        error={hasError}
                        helperText={errors[item.id]}
                      />
                    </>
                  )}

                  {item.type === 'multicheckbox' && (
                    <FormControl component="fieldset" fullWidth error={hasError}>
                      <FormLabel component="legend" sx={{ fontWeight: 'bold', mb: 1, color: hasError ? 'error.main' : undefined }}>
                        {item.label} {item.required && <Chip label="必須" size="small" color="error" sx={{ height: 20, fontSize: 10 }} />}
                      </FormLabel>
                      <FormGroup row>
                        {item.options?.split(',').map(opt => opt.trim()).map((opt) => (
                          <FormControlLabel
                            key={opt}
                            control={
                              <Checkbox
                                checked={(answers[item.id] || []).includes(opt)}
                                onChange={(e) => handleMultiCheckboxChange(item.id, opt, e.target.checked)}
                              />
                            }
                            label={opt}
                            sx={{ width: '48%', mr: 0 }}
                          />
                        ))}
                      </FormGroup>
                      {hasError && <FormHelperText>{errors[item.id]}</FormHelperText>}
                    </FormControl>
                  )}

                  {item.type === 'select' && (
                    <FormControl component="fieldset" fullWidth error={hasError}>
                      <FormLabel component="legend" sx={{ fontWeight: 'bold', color: hasError ? 'error.main' : undefined }}>
                        {item.label} {item.required && <Chip label="必須" size="small" color="error" sx={{ height: 20, fontSize: 10 }} />}
                      </FormLabel>
                      <RadioGroup row value={answers[item.id] || ''} onChange={(e) => handleAnswerChange(item.id, e.target.value)}>
                        {item.options?.split(',').map(opt => opt.trim()).map((opt) => (
                          <FormControlLabel key={opt} value={opt} control={<Radio />} label={opt} />
                        ))}
                      </RadioGroup>
                      {hasError && <FormHelperText>{errors[item.id]}</FormHelperText>}
                    </FormControl>
                  )}

                  {item.hasDetail && (
                    (item.type === 'checkbox' && answers[item.id]) ||
                    (item.type !== 'checkbox' && (answers[item.id] || []).toString().includes('他')) ||
                    (item.type !== 'checkbox' && (answers[item.id] || []).toString().includes('その他'))
                  ) && (
                      <Box mt={1}>
                        <TextField
                          fullWidth
                          size="small"
                          placeholder="詳細を入力してください"
                          variant="filled"
                          hiddenLabel
                          value={answers[`${item.id}_detail`] || ''}
                          onChange={(e) => handleAnswerChange(`${item.id}_detail`, e.target.value)}
                        />
                      </Box>
                    )}

                </Stack>
              </Paper>
            );
          })}
        </Stack>
      </Container>
    </Box>
  );
}