'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box, Button, Container, Typography, TextField, Checkbox, FormControlLabel, Radio, RadioGroup,
  Paper, Stack, IconButton, CircularProgress,
  FormGroup, Switch, Autocomplete, FormHelperText, Chip, Divider, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import PersonIcon from '@mui/icons-material/Person';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import DeleteIcon from '@mui/icons-material/Delete';
import PhotoCamera from '@mui/icons-material/PhotoCamera';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';
import { useWorkspace } from '@/context/WorkspaceContext';

type FormItem = {
  id: string; label: string; type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string; required: boolean; hasDetail?: boolean;
};

// デフォルトテンプレート
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
type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';

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
  const [selectableStaffs, setSelectableStaffs] = useState<HelperProfile[]>([]);
  const [selectedHelpers, setSelectedHelpers] = useState<string[]>([]);
  
  const [startDateTime, setStartDateTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [serviceTime, setServiceTime] = useState('');
  const [travelTime, setTravelTime] = useState('0');
  
  const [currentStatus, setCurrentStatus] = useState<ReportStatus | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [images, setImages] = useState<{id: string, url: string}[]>([]);
  
  const [openCloseDialog, setOpenCloseDialog] = useState(false);
  const [openApproveDialog, setOpenApproveDialog] = useState(false); 
  const [openSubmitDialog, setOpenSubmitDialog] = useState(false);   
  const [openRemandDialog, setOpenRemandDialog] = useState(false);   

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const formatDatetimeLocal = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const fetchBaseData = useCallback(async () => {
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

      let allStaffs: HelperProfile[] = [];
      const { data: members } = await supabase.from('organization_members').select('user_id').eq('organization_id', currentOrg.id);
      if (members) {
        const userIds = members.map((m) => m.user_id);
        const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', userIds);
        if(profiles) allStaffs = [...allStaffs, ...profiles];
      }
      const { data: ghosts } = await supabase.from('ghost_staffs').select('id, name').eq('organization_id', currentOrg.id);
      if(ghosts) allStaffs = [...allStaffs, ...ghosts];

      const { data: assignments } = await supabase.from('assignments').select('helper_id, ghost_staff_id').eq('client_id', clientId);
      let finalStaffList = allStaffs;
      if (assignments && assignments.length > 0) {
          const validIds = new Set(assignments.map(a => a.helper_id || a.ghost_staff_id).filter(id => id !== null));
          if (validIds.size > 0) finalStaffList = allStaffs.filter(s => validIds.has(s.id));
      }
      setSelectableStaffs(finalStaffList);

      if (!reportId && user) {
        const me = finalStaffList.find((p) => p.id === user.id);
        if (me) setSelectedHelpers([me.name]);
      }
    } catch (error) { console.error('Error fetching base data:', error); }
  }, [clientId, currentOrg, reportId]);

  const loadExistingData = useCallback(async () => {
    if (!reportId) return;
    try {
      const { data: r } = await supabase.from('reports').select('*').eq('id', reportId).single();
      const { data: v } = await supabase.from('report_values').select('data').eq('report_id', reportId).single();
      if (r && v) {
        setStartDateTime(formatDatetimeLocal(new Date(r.start_at)));
        setEndDateTime(formatDatetimeLocal(new Date(r.end_at)));
        setCurrentStatus(r.status);
        const data = v.data as FormAnswers & { service_time?: string; travel_time?: string; _helpers?: string[] };
        setServiceTime(data.service_time || '');
        setTravelTime(data.travel_time || '0');
        setSelectedHelpers(data._helpers || []);
        setAnswers(data);
        setIsDirty(false);

        const { data: imgData } = await supabase.from('report_images').select('*').eq('report_id', reportId);
        if (imgData) {
            setImages(imgData.map(i => ({ 
                id: i.id, 
                url: supabase.storage.from('report-images').getPublicUrl(i.storage_path).data.publicUrl 
            })));
        }
      }
    } catch (e) { console.error(e); }
  }, [reportId]);

  useEffect(() => {
    const init = async () => {
      if (!reportId) {
        const now = new Date();
        setStartDateTime(formatDatetimeLocal(now));
        setEndDateTime(formatDatetimeLocal(new Date(now.getTime() + 3600000)));
        setCurrentStatus('draft');
      }
      await fetchBaseData();
      await loadExistingData();
      setLoading(false);
    };

    if (!wsLoading && currentOrg) {
      init();
    }
  }, [wsLoading, currentOrg, reportId, fetchBaseData, loadExistingData]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (isDirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleChange = (setter: (val: string) => void, val: string) => { setter(val); setIsDirty(true); };
  const handleAnswerChange = (id: string, value: string | number | boolean | string[]) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
    setIsDirty(true);
    if (errors[id]) { const ne = { ...errors }; delete ne[id]; setErrors(ne); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!reportId || !e.target.files || e.target.files.length === 0) return;
    setSubmitting(true);
    try {
        const file = e.target.files[0];
        const path = `${reportId}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('report-images').upload(path, file);
        if (error) throw error;
        
        await supabase.from('report_images').insert({ report_id: reportId, storage_path: path });
        
        // リロードして反映
        await loadExistingData();
        showToast('画像をアップロードしました');
    } catch(e) {
        console.error(e);
        showToast('アップロード失敗', 'error');
    } finally {
        setSubmitting(false);
    }
  };

  const handleDeleteReport = async () => {
      if(!confirm('本当に削除しますか？')) return;
      if (currentStatus === 'approved') { showToast('承認済みの記録は削除できません', 'error'); return; }
      try {
        await supabase.from('reports').delete().eq('id', reportId);
        showToast('削除しました');
        router.back();
      } catch(e) {
          console.error(e);
          showToast('削除に失敗しました', 'error');
      }
  };

  const validate = () => {
    const ne: Record<string, string> = {};
    if (!serviceTime) ne['serviceTime'] = '必須項目です';
    if (selectedHelpers.length === 0) ne['helpers'] = '担当ヘルパーを選択してください';
    template.forEach(item => {
      const val = answers[item.id];
      if (item.required && (!val || (Array.isArray(val) && val.length === 0))) ne[item.id] = '必須項目です';
    });
    setErrors(ne);
    return Object.keys(ne).length === 0;
  };

  const saveReport = async (status: ReportStatus, skipValidation = false) => {
    if (!skipValidation && !validate()) { showToast('入力不備があります', 'error'); window.scrollTo({ top: 0, behavior: 'smooth' }); return false; }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const finalData = { ...answers, _helpers: selectedHelpers, service_time: serviceTime, travel_time: travelTime };
      
      const basePayload = {
        client_id: clientId as string,
        start_at: new Date(startDateTime).toISOString(),
        end_at: new Date(endDateTime).toISOString(),
        status: status,
        updated_at: new Date().toISOString()
      };

      let currentReportId = reportId;
      let payload;
      if (!reportId) {
          payload = { ...basePayload, helper_id: user?.id };
      } else {
          payload = basePayload;
      }

      if (reportId) {
        await supabase.from('reports').update(payload).eq('id', reportId);
        await supabase.from('report_values').update({ data: finalData }).eq('report_id', reportId);
      } else {
        const { data: nr } = await supabase.from('reports').insert(payload).select().single();
        if (nr) {
            await supabase.from('report_values').insert({ report_id: nr.id, data: finalData });
            currentReportId = nr.id;
        }
      }
      setIsDirty(false);
      
      // IDがなかった場合はURLを更新して、画像アップロードなどを可能にする
      if (!reportId && currentReportId) {
          const newUrl = `/app/record/${clientId}?reportId=${currentReportId}`;
          router.replace(newUrl);
      }

      return true;
    } catch (e) { console.error(e); showToast('エラーが発生しました', 'error'); return false; } 
    finally { setSubmitting(false); }
  };

  const handleDraftSave = async () => { if (await saveReport('draft', true)) { showToast('下書きを保存しました', 'success'); } };
  const handleSubmit = () => setOpenSubmitDialog(true);
  const executeSubmit = async () => { setOpenSubmitDialog(false); if (await saveReport('pending')) { showToast('記録を送信しました', 'success'); router.push('/app/record'); } };
  const handleApprove = () => setOpenApproveDialog(true);
  const executeApprove = async () => {
      setOpenApproveDialog(false);
      if (await saveReport('approved')) {
          const { data: { user } } = await supabase.auth.getUser();
          if (reportId && user) await supabase.from('reports').update({ approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', reportId);
          showToast('承認しました', 'success');
          router.push('/app/reports');
      }
  };
  const handleRemand = () => setOpenRemandDialog(true);
  const executeRemand = async () => {
      setOpenRemandDialog(false);
      if (await saveReport('remanded')) {
          if (reportId) await supabase.from('reports').update({ approved_by: null, approved_at: null }).eq('id', reportId);
          showToast('記録を差し戻しました', 'info');
          router.push('/app/reports');
      }
  };

  const handleClose = () => { if (isDirty) setOpenCloseDialog(true); else router.back(); };
  const handleDialogDiscard = () => { setOpenCloseDialog(false); router.back(); };
  const handleDialogSaveDraft = async () => { if (await saveReport('draft', true)) { showToast('下書き保存しました'); router.back(); } setOpenCloseDialog(false); };

  const groupedSections = useMemo(() => {
    const sections: { title: string; items: FormItem[] }[] = [];
    let currentSection = { title: '基本項目', items: [] as FormItem[] };
    template.forEach(item => {
      if (item.type === 'section') { if (currentSection.items.length > 0) sections.push(currentSection); currentSection = { title: item.label, items: [] }; } 
      else currentSection.items.push(item);
    });
    if (currentSection.items.length > 0 || currentSection.title !== '基本項目') sections.push(currentSection);
    return sections;
  }, [template]);

  const isAdmin = currentOrg && ['owner', 'manager'].includes(currentOrg.role);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 10 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
       <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
            <IconButton edge="start" onClick={handleClose} sx={{ mr: 1, color: 'action.active' }}><CloseIcon /></IconButton>
            <Typography variant="h6" fontWeight="bold" sx={{ color: 'text.primary', flexGrow: 1 }}>
                {reportId ? (isAdmin && currentStatus === 'pending' ? '記録の確認・承認' : (currentStatus === 'approved' ? '承認済みの記録' : '記録を修正')) : `${clientName} 様`}
            </Typography>
            
            <Stack direction="row" spacing={1}>
                {reportId && currentStatus !== 'approved' && (
                    <IconButton color="error" onClick={handleDeleteReport} disabled={submitting}><DeleteIcon /></IconButton>
                )}
                
                {isAdmin && currentStatus === 'pending' && <Button variant="contained" color="success" size="small" startIcon={<CheckCircleIcon />} onClick={handleApprove} disabled={submitting}>承認</Button>}
                {isAdmin && currentStatus === 'approved' && <Button variant="contained" color="warning" size="small" startIcon={<AssignmentReturnIcon />} onClick={handleRemand} disabled={submitting}>承認取消</Button>}
                {(!isAdmin || currentStatus !== 'pending') && currentStatus !== 'approved' && (
                    <>
                        <Button variant="outlined" size="small" startIcon={<SaveIcon />} onClick={handleDraftSave} disabled={submitting}>下書き</Button>
                        <Button variant="contained" size="small" startIcon={<SendIcon />} onClick={handleSubmit} disabled={submitting} sx={{ fontWeight: 'bold' }}>送信</Button>
                    </>
                )}
            </Stack>
       </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
        <Container maxWidth="md" disableGutters>
            <Stack spacing={4}>
            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, bgcolor: '#fff' }}>
                <Stack spacing={3}>
                <Box>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <PersonIcon fontSize="small" /> 担当スタッフ <Typography component="span" color="error">*</Typography>
                    </Typography>
                    <Autocomplete
                        multiple
                        options={Array.from(new Set(selectableStaffs.map(h => h.name)))}
                        value={selectedHelpers}
                        onChange={(_, v) => {
                        setSelectedHelpers(v as string[]);
                        setIsDirty(true);
                        if (v.length > 0 && errors.helpers) { const newErrors = { ...errors }; delete newErrors.helpers; setErrors(newErrors); }
                        }}
                        renderTags={(value, getTagProps) => value.map((option, index) => { const { key, ...tagProps } = getTagProps({ index }); return <Chip key={key} variant="outlined" label={option} size="small" {...tagProps} />; })}
                        renderInput={(params) => <TextField {...params} placeholder={selectedHelpers.length === 0 ? "スタッフを選択" : ""} error={!!errors.helpers} helperText={errors.helpers} fullWidth />}
                    />
                </Box>

                <Box>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <CalendarTodayIcon fontSize="small" /> サービス日時
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                    <TextField type="datetime-local" fullWidth value={startDateTime} onChange={e => handleChange(setStartDateTime, e.target.value)} InputLabelProps={{ shrink: true }} />
                    <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>～</Typography>
                    <TextField type="datetime-local" fullWidth value={endDateTime} onChange={e => handleChange(setEndDateTime, e.target.value)} InputLabelProps={{ shrink: true }} />
                    </Stack>
                </Box>

                <Box>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <AccessTimeIcon fontSize="small" /> 提供時間 <Typography component="span" color="error">*</Typography>
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField label="サービス提供" type="number" fullWidth value={serviceTime} onChange={e => handleChange(setServiceTime, e.target.value)} error={!!errors.serviceTime} InputProps={{ endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }} inputProps={{ inputMode: 'decimal', step: '0.5' }} />
                        <TextField label="移動" type="number" fullWidth value={travelTime} onChange={e => handleChange(setTravelTime, e.target.value)} InputProps={{ startAdornment: <DirectionsCarIcon color="action" fontSize="small" sx={{ mr: 1 }} />, endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }} inputProps={{ inputMode: 'decimal', step: '0.5' }} />
                    </Stack>
                </Box>
                </Stack>
            </Paper>

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

            <Paper variant="outlined" sx={{ p: 3, mt: 3, borderRadius: 3 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>画像添付</Typography>
                <Stack direction="row" gap={2} flexWrap="wrap">
                    {images.map(img => (
                        <Box key={img.id} component="img" src={img.url} sx={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 1 }} />
                    ))}
                    <IconButton color="primary" component="label" sx={{ width: 100, height: 100, border: '1px dashed #ccc', borderRadius: 1, flexDirection: 'column' }}>
                        <input hidden accept="image/*" type="file" onChange={handleImageUpload} disabled={!reportId} />
                        <PhotoCamera />
                        {!reportId && <Typography variant="caption" sx={{ fontSize: 9 }}>未保存</Typography>}
                    </IconButton>
                </Stack>
                {!reportId && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>※一度下書き保存すると画像を添付できます</Typography>}
            </Paper>

            </Stack>
        </Container>
      </Box>

      {/* Dialogs */}
      <Dialog open={openCloseDialog} onClose={() => setOpenCloseDialog(false)}>
          <DialogTitle>保存されていない変更があります</DialogTitle>
          <DialogContent><DialogContentText>入力内容が保存されていません。<br/>下書きとして保存しますか？</DialogContentText></DialogContent>
          <DialogActions><Button onClick={handleDialogDiscard} color="error">破棄して移動</Button><Button onClick={handleDialogSaveDraft} variant="contained" autoFocus>下書き保存</Button></DialogActions>
      </Dialog>
      <Dialog open={openApproveDialog} onClose={() => setOpenApproveDialog(false)}>
          <DialogTitle>承認の確認</DialogTitle>
          <DialogContent><DialogContentText>この記録を承認しますか？</DialogContentText></DialogContent>
          <DialogActions><Button onClick={() => setOpenApproveDialog(false)}>キャンセル</Button><Button onClick={executeApprove} variant="contained" color="success" autoFocus>承認する</Button></DialogActions>
      </Dialog>
      <Dialog open={openRemandDialog} onClose={() => setOpenRemandDialog(false)}>
          <DialogTitle>承認取消の確認</DialogTitle>
          <DialogContent><DialogContentText>承認を取り消し、差し戻しますか？</DialogContentText></DialogContent>
          <DialogActions><Button onClick={() => setOpenRemandDialog(false)}>キャンセル</Button><Button onClick={executeRemand} variant="contained" color="warning" autoFocus>差し戻す</Button></DialogActions>
      </Dialog>
      <Dialog open={openSubmitDialog} onClose={() => setOpenSubmitDialog(false)}>
          <DialogTitle>送信の確認</DialogTitle>
          <DialogContent><DialogContentText>記録を送信しますか？</DialogContentText></DialogContent>
          <DialogActions><Button onClick={() => setOpenSubmitDialog(false)}>キャンセル</Button><Button onClick={executeSubmit} variant="contained" color="primary" autoFocus>送信する</Button></DialogActions>
      </Dialog>
    </Box>
  );
}