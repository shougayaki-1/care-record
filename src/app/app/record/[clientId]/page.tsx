'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Box, Button, Container, Typography, TextField, Checkbox, FormControlLabel, Radio, RadioGroup,
  FormControl, Paper, Stack, AppBar, Toolbar, IconButton, CircularProgress,
  FormGroup, Switch, Autocomplete, FormHelperText, Chip, Divider
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import PersonIcon from '@mui/icons-material/Person';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';
import { useWorkspace } from '@/context/WorkspaceContext';

type FormItem = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string;
  required: boolean;
  hasDetail?: boolean;
};

// デフォルトテンプレート定義（変更なし）
const DEFAULT_TEMPLATE: FormItem[] = [
    { id: 'sec_medical', label: '【医療的ケア・身体介護】', type: 'section', required: false },
    { id: 'sputum_suction', label: '痰等の吸引（気管・口腔）', type: 'checkbox', required: false },
    { id: 'sputum_cleaning', label: '痰等の吸引に関わる物品の清掃等', type: 'checkbox', required: false },
    { id: 'meal_help', label: '食事介助', type: 'multicheckbox', options: '朝,昼,晩,他', required: false, hasDetail: true },
    { id: 'water_supply', label: '水分補給', type: 'checkbox', required: false },
    { id: 'medication', label: '服薬介助', type: 'checkbox', required: false },
    { id: 'excretion', label: '排泄介助', type: 'checkbox', required: false, hasDetail: true },
    { id: 'urine_disposal', label: '排尿：尿破棄 (ml)', type: 'number', required: false },
    { id: 'oral_care', label: '口腔ケア', type: 'checkbox', required: false },
    { id: 'body_cleaning', label: '清拭・整容介助', type: 'multicheckbox', options: '全身,顔,上肢,下肢,手,足,背,陰部,頭部,臀部,整髪,耳掃除,爪切り,髭剃り,その他', required: false, hasDetail: true },
    { id: 'partial_bath', label: '部分浴', type: 'multicheckbox', options: '手,足,洗髪,陰部洗浄', required: false },
    { id: 'medical_app', label: '処置（シップ・薬・座薬・点眼）', type: 'multicheckbox', options: 'シップ貼付,薬塗布,座薬挿入,点眼', required: false },
    { id: 'change_clothes', label: '更衣介助', type: 'checkbox', required: false, hasDetail: true },
    { id: 'observation', label: '観察', type: 'multicheckbox', options: 'モニター,皮膚,体位置,表情,他', required: false, hasDetail: true },
    { id: 'vital_check', label: 'バイタル測定（実施項目）', type: 'multicheckbox', options: '体温,血圧,脈拍,SpO2,他', required: false, hasDetail: true },
    { id: 'temp_adjust', label: '温度調整', type: 'multicheckbox', options: '体温,室温', required: false },
    { id: 'sec_support', label: '【生活援助・移動支援】', type: 'section', required: false },
    { id: 'position_change', label: '体位・安楽', type: 'multicheckbox', options: '体位交換,良肢位,疼痛緩和,褥瘡予防', required: false },
    { id: 'env_maintenance', label: '環境整備', type: 'checkbox', required: false },
    { id: 'daily_assist_group', label: '日常の補佐', type: 'multicheckbox', options: 'コミュニケーション支援,各関節・筋肉の運動の補助,パソコン等の操作・設定,電話等の補助,書類の整理,家電等の設定・操作,他', required: false, hasDetail: true },
    { id: 'bedding_change', label: '寝具交換', type: 'checkbox', required: false, hasDetail: true },
    { id: 'transfer_assist', label: '移乗介助', type: 'checkbox', required: false },
    { id: 'move_assist', label: '移動介助（手押し車いす）', type: 'checkbox', required: false },
    { id: 'outing_assist', label: '外出介助', type: 'checkbox', required: false },
    { id: 'outing_prep', label: '外出に関する必要物品の用意・後片付', type: 'checkbox', required: false },
    { id: 'sec_housework', label: '【家事・その他】', type: 'section', required: false },
    { id: 'cooking', label: '調理・配膳', type: 'multicheckbox', options: '調理,配膳,下膳,後片付け', required: false },
    { id: 'cleaning', label: '掃除等・ゴミ出し', type: 'multicheckbox', options: '玄関,居間,寝室,台所,廊下,トイレ,浴室,洗面所,物品庫,掃除機,拭き掃除,他', required: false, hasDetail: true },
    { id: 'clothes_mending', label: '衣類の整理・補修', type: 'multicheckbox', options: '衣類の整理,被服の補修', required: false },
    { id: 'proxy_service', label: '代行業務', type: 'multicheckbox', options: '買物,銀行,郵便局,薬受け取り,他', required: false, hasDetail: true },
    { id: 'goods_organize', label: '物品整理', type: 'multicheckbox', options: '医薬品,衣料品,食料品,他', required: false, hasDetail: true },
    { id: 'laundry', label: '洗濯', type: 'multicheckbox', options: '干す,収納', required: false },
    { id: 'consultation', label: '相談援助', type: 'multicheckbox', options: '相談援助,情報収集,提供', required: false },
    { id: 'watching', label: '見守り', type: 'checkbox', required: false },
    { id: 'other_note', label: 'その他', type: 'text', required: false },
    { id: 'hospital_comm', label: '入院時コミュニケーション支援', type: 'checkbox', required: false },
    { id: 'sec_confirm', label: '【確認事項】', type: 'section', required: false },
    { id: 'benefit_change', label: '●給付変更事項', type: 'multicheckbox', options: '時間延長,時間短縮,追加訪問,時間変更', required: false },
    { id: 'exit_check', label: '●退出時確認事項', type: 'multicheckbox', options: '鍵,火元,電気,水道,戸締まり,ガス元栓,ボイラー', required: false },
    { id: 'special_note', label: '《特記事項》', type: 'text', required: false },
];

type FormAnswers = Record<string, string | number | boolean | string[]>;
type HelperProfile = { id: string; name: string };

export default function RecordPage() {
  const router = useRouter();
  const { clientId } = useParams();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const reportId = searchParams.get('reportId');

  const [clientName, setClientName] = useState('');
  const [template, setTemplate] = useState<FormItem[]>([]);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [allHelpers, setAllHelpers] = useState<HelperProfile[]>([]);
  const [selectedHelpers, setSelectedHelpers] = useState<string[]>([]);

  const [startDateTime, setStartDateTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [serviceTime, setServiceTime] = useState('');
  const [travelTime, setTravelTime] = useState('0');

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const formatDatetimeLocal = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  useEffect(() => {
    if (!wsLoading && currentOrg) {
      init();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsLoading, currentOrg, reportId]);

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

  const fetchBaseData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!currentOrg) return;

    try {
      const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
      if (client) {
        setClientName(client.name);
        const { data: tmpl } = await supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle();
        const schema = (tmpl?.schema as FormItem[]) || DEFAULT_TEMPLATE;
        setTemplate(schema.filter(i => i.id !== 'service_time' && i.id !== 'travel_time'));
      }

      const { data: members, error: memberError } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', currentOrg.id);

      if (memberError) throw memberError;

      type MemberIdRow = { user_id: string };
      const userIds = (members as unknown as MemberIdRow[]).map((m) => m.user_id);

      if (userIds.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, name')
          .in('id', userIds);

        if (profileError) throw profileError;
        const helperList = (profiles as HelperProfile[]) || [];
        setAllHelpers(helperList);

        if (!reportId && user) {
          const me = helperList.find((p) => p.id === user.id);
          if (me) {
            setSelectedHelpers([me.name]);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching base data:', error);
    }
  };

  const loadExistingData = async () => {
    try {
      const { data: r } = await supabase.from('reports').select('*').eq('id', reportId).single();
      const { data: v } = await supabase.from('report_values').select('data').eq('report_id', reportId).single();
      if (r && v) {
        setStartDateTime(r.start_at.slice(0, 16));
        setEndDateTime(r.end_at.slice(0, 16));
        const data = v.data as FormAnswers & { service_time?: string; travel_time?: string; _helpers?: string[] };
        setServiceTime(data.service_time || '');
        setTravelTime(data.travel_time || '0');
        setSelectedHelpers(data._helpers || []);
        setAnswers(data);
      }
    } catch (e) { console.error(e); }
  };

  const handleAnswerChange = (id: string, value: string | number | boolean | string[]) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
    if (errors[id]) {
      const ne = { ...errors }; delete ne[id]; setErrors(ne);
    }
  };

  const validate = () => {
    const ne: Record<string, string> = {};
    if (!serviceTime) ne['serviceTime'] = '必須項目です';
    if (selectedHelpers.length === 0) ne['helpers'] = '担当ヘルパーを選択してください';
    template.forEach(item => {
      const val = answers[item.id];
      if (item.required && (!val || (Array.isArray(val) && val.length === 0))) {
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
        client_id: clientId as string,
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
      router.push('/app/record'); 
    } catch (e) {
      console.error(e);
      showToast('エラーが発生しました', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // セクションのグルーピング
  const groupedSections = useMemo(() => {
    const sections: { title: string; items: FormItem[] }[] = [];
    let currentSection = { title: '基本項目', items: [] as FormItem[] };
    template.forEach(item => {
      if (item.type === 'section') {
        if (currentSection.items.length > 0) sections.push(currentSection);
        currentSection = { title: item.label, items: [] };
      } else {
        currentSection.items.push(item);
      }
    });
    if (currentSection.items.length > 0 || currentSection.title !== '基本項目') {
      sections.push(currentSection);
    }
    return sections;
  }, [template]);

  if (loading) return <Box sx={{ textAlign: 'center', p: 10 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ pb: 10 }}>
      {/* ヘッダー */}
       <AppBar position="fixed" elevation={0} sx={{ bgcolor: '#fff', color: '#333', borderBottom: '1px solid #e0e0e0', zIndex: 1100 }}>
        <Container maxWidth="md">
          <Toolbar disableGutters>
            <IconButton edge="start" onClick={() => router.back()} sx={{ mr: 1 }}><CloseIcon /></IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 900 }}>{reportId ? '記録を修正' : `${clientName} 様`}</Typography>
            <Button variant="contained" size="large" startIcon={<SendIcon />} onClick={handleSubmit} disabled={submitting} sx={{ borderRadius: 4, fontWeight: 'bold', px: 4 }}>
              {reportId ? '更新' : '送信'}
            </Button>
          </Toolbar>
        </Container>
      </AppBar>
      <Toolbar />

      {/* メインコンテンツ: maxWidth="md" で横幅を制限 */}
      <Container maxWidth="md" sx={{ mt: 3 }}>
        <Stack spacing={4}>
          
          {/* 1. 基本情報パネル */}
          <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, bgcolor: '#fff' }}>
            <Stack spacing={3}>
              <Box>
                 <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                    <PersonIcon fontSize="small" /> 担当スタッフ <Typography component="span" color="error">*</Typography>
                 </Typography>
                 <Autocomplete
                    multiple
                    options={allHelpers.map(h => h.name)}
                    value={selectedHelpers}
                    onChange={(_, v) => {
                      setSelectedHelpers(v as string[]);
                      if (v.length > 0 && errors.helpers) {
                        const newErrors = { ...errors }; delete newErrors.helpers; setErrors(newErrors);
                      }
                    }}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => {
                        const { key, ...tagProps } = getTagProps({ index });
                        return <Chip key={key} variant="outlined" label={option} size="small" {...tagProps} />;
                      })
                    }
                    renderInput={(params) => (
                      <TextField 
                        {...params} 
                        placeholder={selectedHelpers.length === 0 ? "スタッフを選択" : ""}
                        error={!!errors.helpers}
                        helperText={errors.helpers}
                        fullWidth
                      />
                    )}
                  />
              </Box>

              <Box>
                <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                    <CalendarTodayIcon fontSize="small" /> サービス日時
                 </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                  <TextField 
                    type="datetime-local" 
                    fullWidth 
                    value={startDateTime} 
                    onChange={e => setStartDateTime(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>～</Typography>
                  <TextField 
                    type="datetime-local" 
                    fullWidth 
                    value={endDateTime} 
                    onChange={e => setEndDateTime(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Stack>
              </Box>

              <Box>
                 <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                    <AccessTimeIcon fontSize="small" /> 提供時間 <Typography component="span" color="error">*</Typography>
                 </Typography>
                 <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField 
                      label="サービス提供" 
                      type="number" 
                      fullWidth 
                      value={serviceTime} 
                      onChange={e => setServiceTime(e.target.value)} 
                      error={!!errors.serviceTime} 
                      InputProps={{ endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }}
                      inputProps={{ inputMode: 'decimal', step: '0.5' }} 
                    />
                    <TextField 
                      label="移動" 
                      type="number" 
                      fullWidth 
                      value={travelTime} 
                      onChange={e => setTravelTime(e.target.value)} 
                      InputProps={{ 
                        startAdornment: <DirectionsCarIcon color="action" fontSize="small" sx={{ mr: 1 }} />,
                        endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> 
                      }}
                      inputProps={{ inputMode: 'decimal', step: '0.5' }} 
                    />
                 </Stack>
              </Box>
            </Stack>
          </Paper>

          {/* 2. 各セクションのレンダリング (縦積みリスト形式) */}
          {groupedSections.map((section, idx) => (
            <Paper key={idx} variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: '#fff' }}>
              
              {/* セクションヘッダー */}
              <Box sx={{ 
                bgcolor: '#f8f9fa', 
                px: 3, 
                py: 2, 
                borderBottom: '1px solid #e0e0e0',
                display: 'flex',
                alignItems: 'center'
              }}>
                {/* 
                   修正箇所: borderLeftではなく内側に独立したBoxを配置 
                   これにより親のoverflow:hiddenで角が削れるのを防ぐ
                */}
                <Box sx={{ 
                  width: 6, 
                  height: 28, 
                  bgcolor: '#2255CC', 
                  borderRadius: 1, 
                  mr: 2,
                  flexShrink: 0 
                }} />
                <Typography variant="h6" color="text.primary" fontWeight="bold">
                  {section.title}
                </Typography>
              </Box>

              {/* 項目リスト */}
              <Stack divider={<Divider />}>
                {section.items.map((item) => {
                  const hasError = !!errors[item.id];

                  return (
                    <Box key={item.id} sx={{ p: 3, bgcolor: hasError ? '#fff5f5' : 'transparent' }}>
                      
                      {/* --- A. チェックボックス (トグル) --- */}
                      {item.type === 'checkbox' && (
                        <Box display="flex" flexDirection="column" gap={1}>
                          <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                            <Typography 
                                variant="subtitle1" 
                                fontWeight={answers[item.id] ? "bold" : "normal"}
                                color={answers[item.id] ? "primary.main" : "text.primary"}
                                onClick={() => handleAnswerChange(item.id, !answers[item.id])}
                                sx={{ cursor: 'pointer', flex: 1 }}
                            >
                              {item.label}
                            </Typography>
                            <Switch 
                                checked={!!answers[item.id]} 
                                onChange={e => handleAnswerChange(item.id, e.target.checked)}
                                color="primary"
                            />
                          </Box>
                          
                          {/* 詳細入力エリア */}
                          {item.hasDetail && answers[item.id] && (
                            <TextField 
                              placeholder="詳細を入力してください..." 
                              fullWidth 
                              size="small"
                              variant="outlined"
                              value={answers[`${item.id}_detail`] || ''} 
                              onChange={e => handleAnswerChange(`${item.id}_detail`, e.target.value)} 
                              sx={{ mt: 1 }}
                            />
                          )}
                        </Box>
                      )}

                      {/* --- B. テキスト・数値・時間入力 --- */}
                      {['text', 'number', 'time'].includes(item.type) && (
                        <Box>
                           <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>
                              {item.label} {item.required && <Typography component="span" color="error">*</Typography>}
                           </Typography>
                           <TextField
                              fullWidth 
                              variant="outlined" 
                              type={item.type === 'number' ? 'number' : 'text'}
                              multiline={item.type === 'text'} 
                              minRows={item.type === 'text' ? 3 : 1}
                              value={answers[item.id] || ''} 
                              onChange={e => handleAnswerChange(item.id, e.target.value)}
                              error={hasError} 
                              helperText={errors[item.id]}
                              placeholder={`${item.label}を入力`}
                            />
                        </Box>
                      )}

                      {/* --- C. 複数選択チェックボックス --- */}
                      {item.type === 'multicheckbox' && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1.5, display: 'block' }}>
                              {item.label} {item.required && <Typography component="span" color="error">*</Typography>}
                          </Typography>
                          <FormGroup row sx={{ gap: 1 }}>
                            {item.options?.split(',').map((opt: string) => (
                              <FormControlLabel
                                key={opt}
                                sx={{ 
                                    mr: 2, mb: 1, 
                                    border: '1px solid #e0e0e0', borderRadius: 2, 
                                    px: 1.5, py: 0.5, mx: 0,
                                    '&:hover': { bgcolor: '#f5f5f5' },
                                    bgcolor: ((answers[item.id] as string[]) || []).includes(opt.trim()) ? '#eef2ff' : 'transparent',
                                    borderColor: ((answers[item.id] as string[]) || []).includes(opt.trim()) ? 'primary.main' : '#e0e0e0'
                                }}
                                control={
                                  <Checkbox 
                                    size="small" 
                                    checked={((answers[item.id] as string[]) || []).includes(opt.trim())} 
                                    onChange={e => {
                                      const current = (answers[item.id] as string[]) || [];
                                      const next = e.target.checked ? [...current, opt.trim()] : current.filter((v: string) => v !== opt.trim());
                                      handleAnswerChange(item.id, next);
                                    }} 
                                  />
                                }
                                label={<Typography variant="body2" fontWeight={((answers[item.id] as string[]) || []).includes(opt.trim()) ? 'bold' : 'normal'}>{opt.trim()}</Typography>}
                              />
                            ))}
                          </FormGroup>
                          
                          {/* その他詳細入力 */}
                          {item.hasDetail && String(answers[item.id] || '').includes('他') && (
                            <TextField 
                              placeholder="その他の詳細..." 
                              fullWidth 
                              size="small" 
                              sx={{ mt: 1 }}
                              value={answers[`${item.id}_detail`] || ''} 
                              onChange={e => handleAnswerChange(`${item.id}_detail`, e.target.value)} 
                            />
                          )}
                          {hasError && <FormHelperText error>{errors[item.id]}</FormHelperText>}
                        </Box>
                      )}

                      {/* --- D. ラジオボタン --- */}
                      {item.type === 'select' && (
                        <Box>
                          <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1.5, display: 'block' }}>
                              {item.label} {item.required && <Typography component="span" color="error">*</Typography>}
                          </Typography>
                          <RadioGroup row value={answers[item.id] || ''} onChange={e => handleAnswerChange(item.id, e.target.value)}>
                            {item.options?.split(',').map((opt: string) => (
                              <FormControlLabel 
                                key={opt} 
                                value={opt.trim()} 
                                control={<Radio size="small" />} 
                                label={<Typography variant="body2">{opt.trim()}</Typography>} 
                                sx={{ mr: 3 }}
                              />
                            ))}
                          </RadioGroup>
                          
                          {/* その他詳細入力 */}
                          {item.hasDetail && (answers[item.id] === 'その他' || String(answers[item.id]).includes('他')) && (
                             <TextField 
                                placeholder="詳細..." 
                                fullWidth size="small" 
                                sx={{ mt: 1 }}
                                value={answers[`${item.id}_detail`] || ''} 
                                onChange={e => handleAnswerChange(`${item.id}_detail`, e.target.value)} 
                             />
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
      </Container>
    </Box>
  );
}