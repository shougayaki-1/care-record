'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box, Button, Container, Typography, TextField,
  Stack, IconButton, CircularProgress,
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
import { AiImportButton, AppButton, AppDialog, DateTimeField, DynamicFormField, InnerPageHeader, MultiSelectField, PageLayout } from '@/components/ui';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import { checkRecordPermission } from '@/utils/permissions';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';

type FormItem = {
  id: string; label: string; type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string; required: boolean; hasDetail?: boolean;
};

type FormAnswers = Record<string, string | number | boolean | string[]>;
type HelperProfile = { id: string; name: string; defaultRoundTripDistanceKm?: number };
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
  const [roundTripDistanceKm, setRoundTripDistanceKm] = useState('0');
  const [travelCostRateYenPerKm, setTravelCostRateYenPerKm] = useState(20);
  const [distanceTouched, setDistanceTouched] = useState(false);
  
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

  // AI入力されたフィールドのハイライト管理
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [hasAiDraftSource, setHasAiDraftSource] = useState(false);

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
        setTemplate(schema.filter(i => !['service_time', 'travel_time', 'round_trip_distance_km', 'travel_cost_yen'].includes(i.id)));
      }

      const { data: staffsData } = await supabase
        .from('staffs')
        .select('id, name, user_id')
        .eq('organization_id', currentOrg.id)
        .is('archived_at', null)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });

      const { data: assignmentRows } = await supabase
        .from('assignments')
        .select('staff_id, round_trip_distance_km')
        .eq('client_id', clientId);
      const distanceByStaffId = new Map((assignmentRows || []).map((assignment) => [assignment.staff_id, Number(assignment.round_trip_distance_km || 0)]));
      const allStaffs = (staffsData || []).map(s => ({ id: s.id, name: s.name, user_id: s.user_id, defaultRoundTripDistanceKm: distanceByStaffId.get(s.id) || 0 }));
      setSelectableStaffs(allStaffs);

      if (currentOrg) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('travel_cost_rate_yen_per_km')
          .eq('id', currentOrg.id)
          .maybeSingle();
        setTravelCostRateYenPerKm(Number(orgData?.travel_cost_rate_yen_per_km ?? 20));
      }

      if (!currentReportId && !shiftId && user) {
        const myStaffRecord = allStaffs.find(s => s.user_id === user.id);
        if (myStaffRecord) {
            setSelectedHelpers([myStaffRecord.name]);
            setRoundTripDistanceKm(String(myStaffRecord.defaultRoundTripDistanceKm || 0));
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
      const data = (v?.data || {}) as FormAnswers & { service_time?: string; travel_time?: string; round_trip_distance_km?: string; _helpers?: string[] };
      setServiceTime(data.service_time || '');
      setTravelTime(data.travel_time || '0');
      setRoundTripDistanceKm(data.round_trip_distance_km || '0');
      setTravelCostRateYenPerKm(Number(data.travel_cost_rate_yen_per_km || travelCostRateYenPerKm || 20));
      setDistanceTouched(false);
      setSelectedHelpers(data._helpers || []);
      setAnswers(data);

      if (currentOrg) {
        await auditReportView(currentOrg.id, targetId);
        setImages(await getReportImages(currentOrg.id, targetId));
      }
    } catch (e) { console.error(e); showToast('記録の読み込みに失敗しました', 'error'); }
  }, [showToast, formatDatetimeLocal, currentOrg, travelCostRateYenPerKm]);

  useEffect(() => {
    if (currentReportId || distanceTouched || selectableStaffs.length === 0 || selectedHelpers.length === 0) return;
    const staff = selectableStaffs.find((helper) => helper.name === selectedHelpers[0]);
    if (staff) setRoundTripDistanceKm(String(staff.defaultRoundTripDistanceKm || 0));
  }, [currentReportId, distanceTouched, selectableStaffs, selectedHelpers]);

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
      const distanceKm = parseFloat(roundTripDistanceKm || '0') || 0;
      const finalData = {
        ...answers,
        _helpers: selectedHelpers,
        service_time: serviceTime,
        travel_time: travelTime,
        round_trip_distance_km: roundTripDistanceKm,
        travel_cost_rate_yen_per_km: travelCostRateYenPerKm,
        travel_cost_yen: Math.round(distanceKm * travelCostRateYenPerKm),
      };
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
        ...(status === 'draft' && hasAiDraftSource
          ? { auditSource: 'ai_import' as const, auditFileCount: 1 }
          : {}),
      });
      const targetReportId = result.reportId;
      if (!currentReportId) setCurrentReportId(targetReportId);
      if (status === 'draft') setHasAiDraftSource(false);
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

  const handleAiExtracted = useCallback((result: ExtractionResult) => {
    const filled = new Set(Object.keys(result.values));
    setAnswers(prev => ({ ...prev, ...result.values }));

    const { date, start_at: startAt, end_at: endAt, helper_names: helperNames } = result.meta;
    const startDate = date && startAt ? new Date(`${date}T${startAt}:00`) : null;
    const endDate = date && endAt ? new Date(`${date}T${endAt}:00`) : null;
    if (startDate && Number.isFinite(startDate.getTime())) {
      setStartDateTime(formatDatetimeLocal(startDate));
      filled.add('startDateTime');
    }
    if (endDate && Number.isFinite(endDate.getTime())) {
      setEndDateTime(formatDatetimeLocal(endDate));
      filled.add('endDateTime');
    }
    if (
      startDate &&
      endDate &&
      Number.isFinite(startDate.getTime()) &&
      Number.isFinite(endDate.getTime()) &&
      endDate > startDate
    ) {
      const diffHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
      setServiceTime(String(diffHours));
      filled.add('serviceTime');
    }

    const matchedHelpers = helperNames
      .map((name) => selectableStaffs.find((staff) => staff.name.includes(name) || name.includes(staff.name))?.name)
      .filter((name): name is string => Boolean(name));
    if (matchedHelpers.length > 0) {
      setSelectedHelpers(Array.from(new Set(matchedHelpers)));
      filled.add('_helpers');
    }

    setAiFilledFields(filled);
    setHasAiDraftSource(true);
    setIsDirty(true);
  }, [formatDatetimeLocal, selectableStaffs]);

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

  const isAdmin = Boolean(currentOrg && checkRecordPermission(currentOrg.effectivePermissions, 'approve', true));
  const canDeleteRecord = Boolean(currentOrg && checkRecordPermission(currentOrg.effectivePermissions, 'delete', true));
  const travelCostYen = Math.round((parseFloat(roundTripDistanceKm || '0') || 0) * travelCostRateYenPerKm);

  const handleStaffChange = (value: string[]) => {
      setSelectedHelpers(value);
      if (!currentReportId && !distanceTouched) {
          const staff = selectableStaffs.find((helper) => helper.name === value[0]);
          if (staff) setRoundTripDistanceKm(String(staff.defaultRoundTripDistanceKm || 0));
      }
      setIsDirty(true);
      if (errors.helpers) {
          const newErrors = { ...errors };
          delete newErrors.helpers;
          setErrors(newErrors);
      }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 10 }}><CircularProgress /></Box>;

  return (
    <PageLayout>
       <InnerPageHeader
            icon={<IconButton edge="start" onClick={handleClose} sx={{ color: 'action.active' }}><CloseIcon /></IconButton>}
            title={currentReportId ? (isAdmin && currentStatus === 'pending' ? '記録の確認・承認' : (currentStatus === 'approved' ? '承認済の記録' : '記録を修正')) : `${clientName} 様`}
            actions={(
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent="flex-end">
                {currentReportId && currentStatus !== 'approved' && canDeleteRecord && (
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
            )}
       />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 } }}>
        <Container maxWidth="md" disableGutters sx={{ width: '100%' }}>
            <Stack spacing={{ xs: 2.5, sm: 4 }}>
            
            {/* 月末跨ぎの夜勤の場合のみ表示される分割選択タブコントロール */}
            {isSpanningMonth && (
                <Box sx={{ p: 2, bgcolor: 'background.warning', borderColor: 'warning.light', borderRadius: 1 }}>
                    <Typography variant="subtitle2" fontWeight="bold" color="warning.dark" mb={1.5}>
                        ⚠ このシフトは月末を跨ぐ夜勤のため、請求都合上00:00で分割して記録を登録します。
                    </Typography>
                    <Tabs 
                        value={selectedPart} 
                        onChange={(_, val) => handlePartChange(val)} 
                        variant="scrollable"
                        allowScrollButtonsMobile
                        sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
                    >
                        <Tab value="part1" label={`前半（月末日の24:00まで: ${formatTimeForLabel(originalShiftTimes?.start_at)} 〜 24:00）`} />
                        <Tab value="part2" label={`後半（翌月1日の00:00から: 00:00 〜 ${formatTimeForLabel(originalShiftTimes?.end_at)}）`} />
                    </Tabs>
                </Box>
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

            {currentStatus !== 'approved' && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <AiImportButton
                  organizationId={currentOrg?.id ?? ''}
                  formTemplate={template}
                  clients={[{ id: clientId as string, name: clientName }]}
                  helpers={selectableStaffs.map(s => ({ id: s.id, name: s.name }))}
                  onExtracted={handleAiExtracted}
                  hasExistingValues={Object.keys(answers).length > 0}
                  disabled={submitting || loading || !currentOrg}
                />
              </Box>
            )}

            <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1, bgcolor: 'background.paper' }}>
                <Stack spacing={3}>

                <Box sx={{ bgcolor: aiFilledFields.has('_helpers') ? 'background.aiHighlight' : 'transparent', p: 1, mx: -1, borderRadius: 1 }}>
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

                <Box sx={{ bgcolor: aiFilledFields.has('startDateTime') || aiFilledFields.has('endDateTime') ? 'background.aiHighlight' : 'transparent', p: 1, mx: -1, borderRadius: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <CalendarTodayIcon fontSize="small" /> サービス日時
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <DateTimeField value={startDateTime} onChange={e => handleChange(setStartDateTime, e.target.value)} />
                    <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>～</Typography>
                    <DateTimeField value={endDateTime} onChange={e => handleChange(setEndDateTime, e.target.value)} />
                    </Stack>
                </Box>

                <Box sx={{ bgcolor: aiFilledFields.has('serviceTime') ? 'background.aiHighlight' : 'transparent', p: 1, mx: -1, borderRadius: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <AccessTimeIcon fontSize="small" /> 提供時間 <Typography component="span" color="error">*</Typography>
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField label="サービス提供" type="number" fullWidth value={serviceTime} onChange={e => handleChange(setServiceTime, e.target.value)} onWheel={e => (e.target as HTMLElement).blur()} error={!!errors.serviceTime} slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.5' } }} />
                        <TextField label="移動" type="number" fullWidth value={travelTime} onChange={e => handleChange(setTravelTime, e.target.value)} onWheel={e => (e.target as HTMLElement).blur()} slotProps={{ input: { startAdornment: <DirectionsCarIcon color="action" fontSize="small" sx={{ mr: 1 }} />, endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.5' } }} />
                    </Stack>
                </Box>
                <Box>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                        <DirectionsCarIcon fontSize="small" /> 移動距離・交通費
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
                        <TextField
                            label="往復距離"
                            type="number"
                            fullWidth
                            value={roundTripDistanceKm}
                            onChange={e => { setDistanceTouched(true); handleChange(setRoundTripDistanceKm, e.target.value); }}
                            onWheel={e => (e.target as HTMLElement).blur()}
                            slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">km</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.1' } }}
                        />
                        <Chip label={`交通費 ${travelCostYen.toLocaleString()}円（${travelCostRateYenPerKm.toLocaleString()}円/km）`} color="primary" variant="outlined" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, fontWeight: 'bold' }} />
                    </Stack>
                </Box>
                </Stack>
            </Box>

            {groupedSections.map((section, idx) => (
                <Box key={idx} sx={{ borderRadius: 1, overflow: 'hidden', bgcolor: 'background.paper' }}>
                <Box sx={{ bgcolor: 'background.muted', px: { xs: 2, sm: 3 }, py: { xs: 1.5, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ width: 6, height: 28, bgcolor: 'primary.main', borderRadius: 1, mr: 2, flexShrink: 0 }} />
                    <Typography variant="h6" color="text.primary" fontWeight="bold" sx={{ overflowWrap: 'anywhere', lineHeight: 1.3 }}>{section.title}</Typography>
                </Box>
                <Stack divider={<Divider />}>
                    {section.items.map((item) => {
                    const hasError = !!errors[item.id];
                    const isAiFilled = aiFilledFields.has(item.id);
                    return (
                        <Box key={item.id} sx={{ p: { xs: 2, sm: 3 }, bgcolor: hasError ? 'background.danger' : isAiFilled ? 'background.aiHighlight' : 'transparent' }}>
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
                </Box>
            ))}

            <Box sx={{ p: { xs: 2, sm: 3 }, mt: 3, borderRadius: 1 }}>
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
            </Box>

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
    </PageLayout>
  );
}
