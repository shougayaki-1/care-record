'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box, Button, Container, Typography, TextField,
  Paper, Stack, IconButton, CircularProgress,
  Divider,
  Tabs, Tab, Alert, Chip
} from '@/components/ui/mui';
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
import { useConfirm } from '@/components/ui/ConfirmProvider';
import {
  auditReportView,
  getReportImages,
  saveReport as saveReportAction,
  softDeleteReports,
  uploadReportImage,
} from '@/app/actions/reports';
import { getShiftSuggestions, addShiftLink, removeShiftLink, getLinkedShifts } from '@/app/actions/reportShifts';
import { useWorkspace } from '@/context/WorkspaceContext';
import { AppButton, AppDialog, DateTimeField, DynamicFormField, MultiSelectField } from '@/components/ui';

type FormItem = {
  id: string; label: string; type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string; required: boolean; hasDetail?: boolean;
};

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

type ShiftStaffData = {
    staff_id: string;
    staffs: { name: string } | null;
};

type ShiftSuggestion = { id: string; title: string | null; start_at: string; end_at: string; staffName: string | null };
type LinkedShift = { shift_id: string; is_primary: boolean; shifts: { id: string; title: string | null; start_at: string; end_at: string; shift_staffs: Array<{ staffs: { name: string } | null }> } | null };

export default function RecordPage() {
  const router = useRouter();
  const { clientId } = useParams();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  
  const paramReportId = searchParams.get('reportId');
  const shiftId = searchParams.get('shiftId');

  const [currentReportId, setCurrentReportId] = useState<string | null>(paramReportId);

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

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [shiftSuggestions, setShiftSuggestions] = useState<ShiftSuggestion[]>([]);
  const [linkedShifts, setLinkedShifts] = useState<LinkedShift[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  // 月末跨ぎ夜勤管理ステート
  const [isSpanningMonth, setIsSpanningMonth] = useState(false);
  const [selectedPart, setSelectedPart] = useState<'part1' | 'part2'>('part1');
  const [originalShiftTimes, setOriginalShiftTimes] = useState<{ start_at: string; end_at: string } | null>(null);

  const formatDatetimeLocal = useCallback((date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, []);

  const formatTimeForLabel = (dateStr?: string) => {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const setupTimeForPart = useCallback((part: 'part1' | 'part2', startIso: string, endIso: string) => {
      const s = new Date(startIso);
      const e = new Date(endIso);
      
      if (part === 'part1') {
          // 前半: 開始時刻 〜 月末23:59:59 (00:00)
          setStartDateTime(formatDatetimeLocal(s));
          const midnight = new Date(s.getFullYear(), s.getMonth() + 1, 1, 0, 0, 0);
          setEndDateTime(formatDatetimeLocal(midnight));
          const diff = (midnight.getTime() - s.getTime()) / (1000 * 60 * 60);
          setServiceTime(diff.toString());
      } else {
          // 後半: 翌月00:00 〜 終了時刻
          const midnight = new Date(s.getFullYear(), s.getMonth() + 1, 1, 0, 0, 0);
          setStartDateTime(formatDatetimeLocal(midnight));
          setEndDateTime(formatDatetimeLocal(e));
          const diff = (e.getTime() - midnight.getTime()) / (1000 * 60 * 60);
          setServiceTime(diff.toString());
      }
  }, [formatDatetimeLocal]);

  const handlePartChange = async (part: 'part1' | 'part2') => {
      if (isDirty) {
          if (!(await confirm({ message: '変更内容が保存されていません。切り替えてよろしいですか？' }))) return;
      }
      setSelectedPart(part);
      setIsDirty(false);
      
      if (!shiftId || !originalShiftTimes) return;
      
      const s = new Date(originalShiftTimes.start_at);
      let expectedStartIso: string;
      if (part === 'part1') {
          expectedStartIso = new Date(originalShiftTimes.start_at).toISOString();
      } else {
          expectedStartIso = new Date(s.getFullYear(), s.getMonth() + 1, 1, 0, 0, 0).toISOString();
      }

      const { data: existing } = await supabase
          .from('reports')
          .select('id')
          .eq('shift_id', shiftId)
          .is('deleted_at', null)
          .eq('start_at', expectedStartIso)
          .maybeSingle();

      if (existing) {
          setCurrentReportId(existing.id);
          router.replace(`/app/record/${clientId}?reportId=${existing.id}&shiftId=${shiftId}`);
          await loadExistingData(existing.id);
      } else {
          setCurrentReportId(null);
          router.replace(`/app/record/${clientId}?shiftId=${shiftId}`);
          setupTimeForPart(part, originalShiftTimes.start_at, originalShiftTimes.end_at);
          setAnswers({});
          setCurrentStatus('draft');
      }
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

      const { data: staffsData } = await supabase
        .from('staffs')
        .select('id, name, user_id')
        .eq('organization_id', currentOrg.id)
        .is('archived_at', null)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });

      const allStaffs = (staffsData || []).map(s => ({ id: s.id, name: s.name, user_id: s.user_id }));
      setSelectableStaffs(allStaffs);

      if (!currentReportId && !shiftId && user) {
        const myStaffRecord = allStaffs.find(s => s.user_id === user.id);
        if (myStaffRecord) {
            setSelectedHelpers([myStaffRecord.name]);
        }
      }
    } catch (error) { console.error('Error fetching base data:', error); }
  }, [clientId, currentOrg, currentReportId, shiftId]);

  const loadExistingData = useCallback(async (targetId: string) => {
    if (!targetId) return;
    try {
      // ★修正: reports と shifts には外部キーが無く埋め込み(shifts(...))が400になるため、shift_id で別途取得する
      const { data: r, error: rError } = await supabase.from('reports').select('*').eq('id', targetId).is('deleted_at', null).maybeSingle();
      if (rError) throw rError;
      if (!r) { showToast('記録が見つかりませんでした', 'error'); return; }

      // ★修正: report_values が無い/読めない場合でも、基本情報（日時・ステータス）は表示する
      setStartDateTime(formatDatetimeLocal(new Date(r.start_at)));
      setEndDateTime(formatDatetimeLocal(new Date(r.end_at)));
      setCurrentStatus(r.status);
      setIsDirty(false);

      if (r.shift_id) {
          const { data: shift } = await supabase.from('shifts').select('start_at, end_at').eq('id', r.shift_id).maybeSingle();
          if (shift) {
              const s = new Date(shift.start_at);
              const e = new Date(shift.end_at);
              const isCrossMonth = s.getMonth() !== e.getMonth();
              setIsSpanningMonth(isCrossMonth);
              setOriginalShiftTimes({ start_at: shift.start_at, end_at: shift.end_at });

              if (isCrossMonth) {
                  const isPart1 = new Date(r.start_at).getTime() === s.getTime();
                  setSelectedPart(isPart1 ? 'part1' : 'part2');
              }
          }
      }

      // ★修正: .single() だと行欠落/複数行でエラーになり全項目が空になるため maybeSingle に変更
      const { data: v, error: vError } = await supabase.from('report_values').select('data').eq('report_id', targetId).maybeSingle();
      if (vError) console.error('report_values load error:', vError);
      const data = (v?.data || {}) as FormAnswers & { service_time?: string; travel_time?: string; _helpers?: string[] };
      setServiceTime(data.service_time || '');
      setTravelTime(data.travel_time || '0');
      setSelectedHelpers(data._helpers || []);
      setAnswers(data);

      if (currentOrg) {
        await auditReportView(currentOrg.id, targetId);
        setImages(await getReportImages(currentOrg.id, targetId));
      }
    } catch (e) { console.error(e); showToast('記録の読み込みに失敗しました', 'error'); }
  }, [showToast, formatDatetimeLocal, currentOrg]);

  useEffect(() => {
    const init = async () => {
      let targetId = paramReportId;

      if (shiftId && !paramReportId) {
          const { data: existingReport } = await supabase
              .from('reports')
              .select('id')
              .eq('shift_id', shiftId)
              .is('deleted_at', null)
              .maybeSingle();
          
          if (existingReport) {
              targetId = existingReport.id;
              setCurrentReportId(targetId);
              router.replace(`/app/record/${clientId}?reportId=${targetId}`);
              showToast('このシフトにはすでに記録が存在します。該当する記録を開きました。', 'info');
          } else {
              const { data: shiftData } = await supabase
                  .from('shifts')
                  .select(`
                      start_at, end_at, 
                      shift_staffs (
                          staff_id, 
                          staffs (name)
                      )
                  `)
                  .eq('id', shiftId)
                  .single();
              
              if (shiftData) {
                  const s = new Date(shiftData.start_at);
                  const e = new Date(shiftData.end_at);
                  const isCrossMonth = s.getMonth() !== e.getMonth();
                  
                  setIsSpanningMonth(isCrossMonth);
                  setOriginalShiftTimes({ start_at: shiftData.start_at, end_at: shiftData.end_at });

                  if (isCrossMonth) {
                      setupTimeForPart('part1', shiftData.start_at, shiftData.end_at);
                  } else {
                      setStartDateTime(formatDatetimeLocal(s));
                      setEndDateTime(formatDatetimeLocal(e));
                      const diffHours = (e.getTime() - s.getTime()) / (1000 * 60 * 60);
                      setServiceTime(diffHours.toString());
                  }

                  const staffNames: string[] = [];
                  const typedShiftStaffs = (shiftData.shift_staffs as unknown as ShiftStaffData[]) || [];
                  
                  typedShiftStaffs.forEach(s => {
                      const name = Array.isArray(s.staffs) ? s.staffs[0]?.name : s.staffs?.name;
                      if (name) staffNames.push(name);
                  });

                  setSelectedHelpers(staffNames);
                  setCurrentStatus('draft');
              }
          }
      }

      if (!targetId && !shiftId) {
        const now = new Date();
        setStartDateTime(formatDatetimeLocal(now));
        setEndDateTime(formatDatetimeLocal(new Date(now.getTime() + 3600000)));
        setCurrentStatus('draft');
      }

      await fetchBaseData();
      if (targetId) {
          await loadExistingData(targetId);
      }
      setLoading(false);
    };

    if (!wsLoading && currentOrg) {
      init();
    }
  }, [wsLoading, currentOrg, paramReportId, shiftId, clientId, router, showToast, fetchBaseData, loadExistingData, formatDatetimeLocal, setupTimeForPart]);

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

  useEffect(() => {
    if (!currentReportId || !currentOrg) return;
    void Promise.all([
      getLinkedShifts(currentReportId).then(data => setLinkedShifts(data as LinkedShift[])),
      getShiftSuggestions(currentOrg.id, currentReportId).then(setShiftSuggestions),
    ]);
  }, [currentReportId, currentOrg]);

  const handleChange = (setter: (val: string) => void, val: string) => { setter(val); setIsDirty(true); };
  const handleAnswerChange = (id: string, value: string | number | boolean | string[]) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
    setIsDirty(true);
    if (errors[id]) { const ne = { ...errors }; delete ne[id]; setErrors(ne); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentReportId || !e.target.files || e.target.files.length === 0) return;
    setSubmitting(true);
    try {
        if (!currentOrg) throw new Error('事業所が選択されていません');
        const formData = new FormData();
        formData.set('organizationId', currentOrg.id);
        formData.set('reportId', currentReportId);
        formData.set('file', e.target.files[0]);
        await uploadReportImage(formData);
        await loadExistingData(currentReportId);
        showToast('画像をアップロードしました');
    } catch(e) {
        console.error(e);
        showToast('アップロード失敗', 'error');
    } finally {
        setSubmitting(false);
    }
  };

  const handleDeleteReport = async () => {
      if (currentStatus === 'approved') { showToast('承認済みの記録は削除できません', 'error'); return; }
      if(!(await confirm({ title: '記録の削除', message: '本当に削除しますか？', confirmText: '削除する', confirmColor: 'error' }))) return;
      try {
        if (!currentReportId || !currentOrg) throw new Error('削除対象が不正です');
        await softDeleteReports(currentOrg.id, [currentReportId], '記録編集画面から削除');
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
    if (selectedHelpers.length === 0) ne['helpers'] = '担当スタッフを選択してください';
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
      const finalData = { ...answers, _helpers: selectedHelpers, service_time: serviceTime, travel_time: travelTime };
      if (!currentOrg) throw new Error('事業所が選択されていません');
      const result = await saveReportAction({
        organizationId: currentOrg.id,
        reportId: currentReportId,
        clientId: clientId as string,
        startAt: new Date(startDateTime).toISOString(),
        endAt: new Date(endDateTime).toISOString(),
        status,
        shiftId: shiftId || null,
        values: finalData,
      });
      const targetReportId = result.reportId;
      if (!currentReportId) setCurrentReportId(targetReportId);
      setIsDirty(false);
      
      if (!currentReportId && targetReportId) {
          const newUrl = `/app/record/${clientId}?reportId=${targetReportId}`;
          router.replace(newUrl);
      }

      return true;
    } catch (e) { console.error(e); showToast('エラーが発生しました', 'error'); return false; } 
    finally { setSubmitting(false); }
  };

  const handleDraftSave = async () => { if (await saveReport('draft', true)) { showToast('下書きを保存しました', 'success'); } };
  const handleSubmit = async () => {
      if (!(await confirm({ title: '送信の確認', message: '記録を送信しますか？', confirmText: '送信する' }))) return;
      if (await saveReport('pending')) { showToast('記録を送信しました', 'success'); router.push('/app/record'); }
  };
  const handleApprove = async () => {
      if (!(await confirm({ title: '承認の確認', message: 'この記録を承認しますか？', confirmText: '承認する', confirmColor: 'primary' }))) return;
      await executeApprove();
  };
  const executeApprove = async () => {
      if (await saveReport('approved')) {
          showToast('承認しました', 'success');
          router.push('/app/reports');
      }
  };
  const handleRemand = async () => {
      if (!(await confirm({ title: '承認取消の確認', message: '承認を取り消し、差し戻しますか？', confirmText: '差し戻す', confirmColor: 'warning' }))) return;
      await executeRemand();
  };
  const executeRemand = async () => {
      if (await saveReport('remanded')) {
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

  const handleStaffChange = (value: string[]) => {
      setSelectedHelpers(value);
      setIsDirty(true);
      if (errors.helpers) {
          const newErrors = { ...errors };
          delete newErrors.helpers;
          setErrors(newErrors);
      }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 10 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
       <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
            <IconButton edge="start" onClick={handleClose} sx={{ mr: 1, color: 'action.active' }}><CloseIcon /></IconButton>
            <Typography variant="h6" fontWeight="bold" sx={{ color: 'text.primary', flexGrow: 1 }}>
                {currentReportId ? (isAdmin && currentStatus === 'pending' ? '記録の確認・承認' : (currentStatus === 'approved' ? '承認済みの記録' : '記録を修正')) : `${clientName} 様`}
            </Typography>
            
            <Stack direction="row" spacing={1}>
                {currentReportId && currentStatus !== 'approved' && (
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
            
            {/* 月末跨ぎの夜勤の場合のみ表示される分割選択タブコントロール */}
            {isSpanningMonth && (
                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.warning', borderColor: 'warning.light', borderRadius: 3 }}>
                    <Typography variant="subtitle2" fontWeight="bold" color="warning.dark" mb={1.5}>
                        ⚠ このシフトは月末を跨ぐ夜勤のため、請求都合上00:00で分割して記録を登録します。
                    </Typography>
                    <Tabs 
                        value={selectedPart} 
                        onChange={(_, val) => handlePartChange(val)} 
                        variant="fullWidth"
                        sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
                    >
                        <Tab value="part1" label={`前半（月末日の24:00まで: ${formatTimeForLabel(originalShiftTimes?.start_at)} 〜 24:00）`} />
                        <Tab value="part2" label={`後半（翌月1日の00:00から: 00:00 〜 ${formatTimeForLabel(originalShiftTimes?.end_at)}）`} />
                    </Tabs>
                </Paper>
            )}

            {shiftSuggestions
              .filter(s => !dismissedSuggestions.has(s.id))
              .map(suggestion => {
                const startStr = new Date(suggestion.start_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                const endStr = new Date(suggestion.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                return (
                  <Alert
                    key={suggestion.id}
                    severity="warning"
                    sx={{ mb: 1 }}
                    action={
                      <Box display="flex" gap={1}>
                        <Button size="small" onClick={async () => {
                          if (!currentOrg || !currentReportId) return;
                          try {
                            await addShiftLink(currentOrg.id, currentReportId, suggestion.id);
                            const [linked, suggestions] = await Promise.all([
                              getLinkedShifts(currentReportId),
                              getShiftSuggestions(currentOrg.id, currentReportId),
                            ]);
                            setLinkedShifts(linked as LinkedShift[]);
                            setShiftSuggestions(suggestions);
                          } catch (e) { console.error(e); showToast('シフトの紐付けに失敗しました', 'error'); }
                        }}>紐付ける</Button>
                        <Button size="small" onClick={() =>
                          setDismissedSuggestions(prev => new Set([...prev, suggestion.id]))
                        }>無視する</Button>
                      </Box>
                    }
                  >
                    {suggestion.staffName ?? 'スタッフ'}（{startStr}〜{endStr}）のシフトを紐付けますか？
                  </Alert>
                );
              })}

            {linkedShifts.length > 0 && (
              <Box mb={2}>
                <Typography variant="subtitle2" gutterBottom>担当シフト</Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {linkedShifts.map(link => {
                    const shift = link.shifts;
                    if (!shift) return null;
                    const startStr = new Date(shift.start_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                    const endStr = new Date(shift.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                    const staffName = shift.shift_staffs?.[0]?.staffs?.name ?? '';
                    return (
                      <Chip
                        key={link.shift_id}
                        label={`${staffName} ${startStr}〜${endStr}${link.is_primary ? ' [主]' : ''}`}
                        onDelete={link.is_primary ? undefined : async () => {
                          if (!currentOrg || !currentReportId) return;
                          try {
                            await removeShiftLink(currentOrg.id, currentReportId, link.shift_id);
                            setLinkedShifts((await getLinkedShifts(currentReportId)) as LinkedShift[]);
                          } catch (e) { console.error(e); showToast('シフトの解除に失敗しました', 'error'); }
                        }}
                      />
                    );
                  })}
                </Box>
              </Box>
            )}

            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, bgcolor: 'background.paper' }}>
                <Stack spacing={3}>

                <Box>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <PersonIcon fontSize="small" /> 担当スタッフ <Typography component="span" color="error">*</Typography>
                    </Typography>
                    <MultiSelectField
                        required
                        label="担当スタッフ"
                        options={Array.from(new Set(selectableStaffs.map((helper) => helper.name)))}
                        value={selectedHelpers}
                        onChange={handleStaffChange}
                        getOptionLabel={(name) => name}
                        getOptionValue={(name) => name}
                        error={!!errors.helpers}
                        helperText={errors.helpers}
                        placeholder="スタッフ名簿から選択"
                    />
                </Box>

                <Box>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <CalendarTodayIcon fontSize="small" /> サービス日時
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                    <DateTimeField value={startDateTime} onChange={e => handleChange(setStartDateTime, e.target.value)} />
                    <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>～</Typography>
                    <DateTimeField value={endDateTime} onChange={e => handleChange(setEndDateTime, e.target.value)} />
                    </Stack>
                </Box>

                <Box>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <AccessTimeIcon fontSize="small" /> 提供時間 <Typography component="span" color="error">*</Typography>
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField label="サービス提供" type="number" fullWidth value={serviceTime} onChange={e => handleChange(setServiceTime, e.target.value)} onWheel={e => (e.target as HTMLElement).blur()} error={!!errors.serviceTime} slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.5' } }} />
                        <TextField label="移動" type="number" fullWidth value={travelTime} onChange={e => handleChange(setTravelTime, e.target.value)} onWheel={e => (e.target as HTMLElement).blur()} slotProps={{ input: { startAdornment: <DirectionsCarIcon color="action" fontSize="small" sx={{ mr: 1 }} />, endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.5' } }} />
                    </Stack>
                </Box>
                </Stack>
            </Paper>

            {groupedSections.map((section, idx) => (
                <Paper key={idx} variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
                <Box sx={{ bgcolor: 'background.muted', px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ width: 6, height: 28, bgcolor: 'primary.main', borderRadius: 1, mr: 2, flexShrink: 0 }} />
                    <Typography variant="h6" color="text.primary" fontWeight="bold">{section.title}</Typography>
                </Box>
                <Stack divider={<Divider />}>
                    {section.items.map((item) => {
                    const hasError = !!errors[item.id];
                    return (
                        <Box key={item.id} sx={{ p: 3, bgcolor: hasError ? 'background.danger' : 'transparent' }}>
                          <DynamicFormField
                            item={item}
                            value={answers[item.id]}
                            detailValue={String(answers[`${item.id}_detail`] ?? '')}
                            error={errors[item.id]}
                            onChange={(value) => handleAnswerChange(item.id, value)}
                            onDetailChange={(value) => handleAnswerChange(`${item.id}_detail`, value)}
                          />
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
                    <IconButton color="primary" component="label" sx={{ width: 100, height: 100, border: '1px dashed', borderColor: 'divider', borderRadius: 1, flexDirection: 'column' }}>
                        <input hidden accept="image/*" type="file" onChange={handleImageUpload} disabled={!currentReportId} />
                        <PhotoCamera />
                        {!currentReportId && <Typography variant="caption" sx={{ fontSize: 9 }}>未保存</Typography>}
                    </IconButton>
                </Stack>
                {!currentReportId && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>※一度下書き保存すると画像を添付できます</Typography>}
            </Paper>

            </Stack>
        </Container>
      </Box>

      <AppDialog
        open={openCloseDialog}
        onClose={() => setOpenCloseDialog(false)}
        title="保存されていない変更があります"
        dividers={false}
        actions={<><AppButton variant="text" intent="danger" onClick={handleDialogDiscard}>破棄して移動</AppButton><AppButton onClick={handleDialogSaveDraft} autoFocus>下書き保存</AppButton></>}
      >
        <Typography>入力内容が保存されていません。下書きとして保存しますか？</Typography>
      </AppDialog>
    </Box>
  );
}
