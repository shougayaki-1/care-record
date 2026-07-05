'use client';

import React, { useEffect, useReducer, useMemo, useCallback } from 'react';
import {
  Box, Button, Container, Typography, TextField,
  Stack, IconButton, CircularProgress,
  Divider,
  Tabs, Tab, Alert, Chip, MenuItem
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
type HelperProfile = { id: string; name: string; defaultRoundTripDistanceKm?: number; defaultTravelCostRateYenPerKm?: number };
type StaffRoleOption = { id: string; name: string };
type ServiceTypeOption = { id: string; name: string };
type ActualStaffInput = { staff_id: string; staff_role_id: string | null };
type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';

type ShiftStaffData = {
    staff_id: string;
    staffs: { name: string } | null;
};

type ShiftSegmentData = {
    id: string;
    start_at: string;
    end_at: string;
    service_type_id?: string | null;
    service_type?: { id?: string; name: string } | null;
    shift_segment_staffs?: Array<{
        staff_id: string;
        staff_role_id?: string | null;
        staff?: { name: string } | null;
    }>;
};

type ShiftSuggestion = { id: string; title: string | null; start_at: string; end_at: string; staffName: string | null };
type LinkedShift = { shift_id: string; is_primary: boolean; shifts: { id: string; title: string | null; start_at: string; end_at: string; shift_staffs: Array<{ staffs: { name: string } | null }> } | null };

type FormState = {
  clientName: string;
  template: FormItem[];
  answers: FormAnswers;
  selectableStaffs: HelperProfile[];
  staffRoles: StaffRoleOption[];
  serviceTypes: ServiceTypeOption[];
  selectedHelpers: string[];
  actualStaffs: ActualStaffInput[];
  actualServiceTypeId: string;
  startDateTime: string;
  endDateTime: string;
  serviceTime: string;
  travelTime: string;
  roundTripDistanceKm: string;
  travelCostRateYenPerKm: number;
  distanceTouched: boolean;
  images: { id: string; url: string }[];
  aiFilledFields: Set<string>;
  hasAiDraftSource: boolean;
  isSpanningMonth: boolean;
  selectedPart: 'part1' | 'part2';
  originalShiftTimes: { start_at: string; end_at: string } | null;
};

type UiState = {
  currentReportId: string | null;
  currentStatus: ReportStatus | null;
  isDirty: boolean;
  openCloseDialog: boolean;
  loading: boolean;
  errors: Record<string, string>;
  submitting: boolean;
};

type ShiftState = {
  shiftSuggestions: ShiftSuggestion[];
  linkedShifts: LinkedShift[];
  dismissedSuggestions: Set<string>;
  shiftSegments: ShiftSegmentData[];
  selectedSegmentId: string | null;
};

type SetStateValue<T> = T | ((prev: T) => T);

type FormAction =
  | { type: 'SET_FIELD'; field: keyof FormState; value: SetStateValue<unknown> }
  | { type: 'SET_ANSWER'; id: string; value: FormAnswers[string] }
  | { type: 'SET_ANSWERS'; value: SetStateValue<FormAnswers> }
  | { type: 'CLEAR_ANSWERS' }
  | { type: 'AI_FILL'; answers: FormAnswers; fields: Set<string> };

type UiAction =
  | { type: 'SET_FIELD'; field: keyof UiState; value: SetStateValue<unknown> }
  | { type: 'MARK_DIRTY'; dirty?: boolean }
  | { type: 'SET_ERROR_MAP'; errors: Record<string, string> }
  | { type: 'CLEAR_ERROR'; id: string };

type ShiftAction =
  | { type: 'SET_FIELD'; field: keyof ShiftState; value: SetStateValue<unknown> }
  | { type: 'DISMISS_SUGGESTION'; id: string };

const resolveStateValue = <T,>(value: SetStateValue<T>, prev: T): T => (
  typeof value === 'function' ? (value as (prev: T) => T)(prev) : value
);

const formInitialState: FormState = {
  clientName: '',
  template: [],
  answers: {},
  selectableStaffs: [],
  staffRoles: [],
  serviceTypes: [],
  selectedHelpers: [],
  actualStaffs: [],
  actualServiceTypeId: '',
  startDateTime: '',
  endDateTime: '',
  serviceTime: '',
  travelTime: '0',
  roundTripDistanceKm: '0',
  travelCostRateYenPerKm: 20,
  distanceTouched: false,
  images: [],
  aiFilledFields: new Set(),
  hasAiDraftSource: false,
  isSpanningMonth: false,
  selectedPart: 'part1',
  originalShiftTimes: null,
};

const createUiInitialState = (currentReportId: string | null): UiState => ({
  currentReportId,
  currentStatus: null,
  isDirty: false,
  openCloseDialog: false,
  loading: true,
  errors: {},
  submitting: false,
});

const createShiftInitialState = (selectedSegmentId: string | null): ShiftState => ({
  shiftSuggestions: [],
  linkedShifts: [],
  dismissedSuggestions: new Set(),
  shiftSegments: [],
  selectedSegmentId,
});

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: resolveStateValue(action.value, state[action.field]) };
    case 'SET_ANSWER':
      return { ...state, answers: { ...state.answers, [action.id]: action.value } };
    case 'SET_ANSWERS':
      return { ...state, answers: resolveStateValue(action.value, state.answers) };
    case 'CLEAR_ANSWERS':
      return { ...state, answers: {} };
    case 'AI_FILL':
      return {
        ...state,
        answers: { ...state.answers, ...action.answers },
        aiFilledFields: action.fields,
        hasAiDraftSource: true,
      };
    default:
      return state;
  }
}

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: resolveStateValue(action.value, state[action.field]) };
    case 'MARK_DIRTY':
      return { ...state, isDirty: action.dirty ?? true };
    case 'SET_ERROR_MAP':
      return { ...state, errors: action.errors };
    case 'CLEAR_ERROR': {
      if (!state.errors[action.id]) return state;
      const nextErrors = { ...state.errors };
      delete nextErrors[action.id];
      return { ...state, errors: nextErrors };
    }
    default:
      return state;
  }
}

function shiftReducer(state: ShiftState, action: ShiftAction): ShiftState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: resolveStateValue(action.value, state[action.field]) };
    case 'DISMISS_SUGGESTION':
      return { ...state, dismissedSuggestions: new Set([...state.dismissedSuggestions, action.id]) };
    default:
      return state;
  }
}

const FormFieldItem = React.memo(function FormFieldItem({
  item,
  value,
  detailValue,
  error,
  isAiFilled,
  onAnswerChange,
}: {
  item: FormItem;
  value: FormAnswers[string] | undefined;
  detailValue: string;
  error?: string;
  isAiFilled: boolean;
  onAnswerChange: (id: string, value: FormAnswers[string]) => void;
}) {
  const handleChange = useCallback((nextValue: FormAnswers[string]) => {
    onAnswerChange(item.id, nextValue);
  }, [item.id, onAnswerChange]);

  const handleDetailChange = useCallback((nextValue: string) => {
    onAnswerChange(`${item.id}_detail`, nextValue);
  }, [item.id, onAnswerChange]);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, bgcolor: error ? 'background.danger' : isAiFilled ? 'background.aiHighlight' : 'transparent' }}>
      <DynamicFormField
        item={item}
        value={value}
        detailValue={detailValue}
        error={error}
        onChange={handleChange}
        onDetailChange={handleDetailChange}
      />
    </Box>
  );
});

export default function RecordPage() {
  const router = useRouter();
  const { clientId } = useParams();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { currentOrg, loading: wsLoading, userId } = useWorkspace();
  
  const paramReportId = searchParams.get('reportId');
  const shiftId = searchParams.get('shiftId');
  const segmentId = searchParams.get('segmentId');

  const [formState, formDispatch] = useReducer(formReducer, formInitialState);
  const [uiState, uiDispatch] = useReducer(uiReducer, paramReportId, createUiInitialState);
  const [shiftState, shiftDispatch] = useReducer(shiftReducer, segmentId, createShiftInitialState);

  const {
    clientName,
    template,
    answers,
    selectableStaffs,
    staffRoles,
    serviceTypes,
    selectedHelpers,
    actualStaffs,
    actualServiceTypeId,
    startDateTime,
    endDateTime,
    serviceTime,
    travelTime,
    roundTripDistanceKm,
    travelCostRateYenPerKm,
    distanceTouched,
    images,
    aiFilledFields,
    hasAiDraftSource,
    isSpanningMonth,
    selectedPart,
    originalShiftTimes,
  } = formState;
  const { currentReportId, currentStatus, isDirty, openCloseDialog, loading, errors, submitting } = uiState;
  const { shiftSuggestions, linkedShifts, dismissedSuggestions, shiftSegments, selectedSegmentId } = shiftState;

  const setFormField = useCallback(<K extends keyof FormState>(field: K, value: SetStateValue<FormState[K]>) => {
    formDispatch({ type: 'SET_FIELD', field, value });
  }, []);
  const setUiField = useCallback(<K extends keyof UiState>(field: K, value: SetStateValue<UiState[K]>) => {
    uiDispatch({ type: 'SET_FIELD', field, value });
  }, []);
  const setShiftField = useCallback(<K extends keyof ShiftState>(field: K, value: SetStateValue<ShiftState[K]>) => {
    shiftDispatch({ type: 'SET_FIELD', field, value });
  }, []);

  const setClientName = useCallback((value: SetStateValue<string>) => setFormField('clientName', value), [setFormField]);
  const setTemplate = useCallback((value: SetStateValue<FormItem[]>) => setFormField('template', value), [setFormField]);
  const setAnswers = useCallback((value: SetStateValue<FormAnswers>) => formDispatch({ type: 'SET_ANSWERS', value }), []);
  const setSelectableStaffs = useCallback((value: SetStateValue<HelperProfile[]>) => setFormField('selectableStaffs', value), [setFormField]);
  const setStaffRoles = useCallback((value: SetStateValue<StaffRoleOption[]>) => setFormField('staffRoles', value), [setFormField]);
  const setServiceTypes = useCallback((value: SetStateValue<ServiceTypeOption[]>) => setFormField('serviceTypes', value), [setFormField]);
  const setSelectedHelpers = useCallback((value: SetStateValue<string[]>) => setFormField('selectedHelpers', value), [setFormField]);
  const setActualStaffs = useCallback((value: SetStateValue<ActualStaffInput[]>) => setFormField('actualStaffs', value), [setFormField]);
  const setActualServiceTypeId = useCallback((value: SetStateValue<string>) => setFormField('actualServiceTypeId', value), [setFormField]);
  const setStartDateTime = useCallback((value: SetStateValue<string>) => setFormField('startDateTime', value), [setFormField]);
  const setEndDateTime = useCallback((value: SetStateValue<string>) => setFormField('endDateTime', value), [setFormField]);
  const setServiceTime = useCallback((value: SetStateValue<string>) => setFormField('serviceTime', value), [setFormField]);
  const setTravelTime = useCallback((value: SetStateValue<string>) => setFormField('travelTime', value), [setFormField]);
  const setRoundTripDistanceKm = useCallback((value: SetStateValue<string>) => setFormField('roundTripDistanceKm', value), [setFormField]);
  const setTravelCostRateYenPerKm = useCallback((value: SetStateValue<number>) => setFormField('travelCostRateYenPerKm', value), [setFormField]);
  const setDistanceTouched = useCallback((value: SetStateValue<boolean>) => setFormField('distanceTouched', value), [setFormField]);
  const setImages = useCallback((value: SetStateValue<{ id: string; url: string }[]>) => setFormField('images', value), [setFormField]);
  const setAiFilledFields = useCallback((value: SetStateValue<Set<string>>) => setFormField('aiFilledFields', value), [setFormField]);
  const setHasAiDraftSource = useCallback((value: SetStateValue<boolean>) => setFormField('hasAiDraftSource', value), [setFormField]);
  const setIsSpanningMonth = useCallback((value: SetStateValue<boolean>) => setFormField('isSpanningMonth', value), [setFormField]);
  const setSelectedPart = useCallback((value: SetStateValue<'part1' | 'part2'>) => setFormField('selectedPart', value), [setFormField]);
  const setOriginalShiftTimes = useCallback((value: SetStateValue<{ start_at: string; end_at: string } | null>) => setFormField('originalShiftTimes', value), [setFormField]);

  const setCurrentReportId = useCallback((value: SetStateValue<string | null>) => setUiField('currentReportId', value), [setUiField]);
  const setCurrentStatus = useCallback((value: SetStateValue<ReportStatus | null>) => setUiField('currentStatus', value), [setUiField]);
  const setIsDirty = useCallback((value: SetStateValue<boolean>) => setUiField('isDirty', value), [setUiField]);
  const setOpenCloseDialog = useCallback((value: SetStateValue<boolean>) => setUiField('openCloseDialog', value), [setUiField]);
  const setLoading = useCallback((value: SetStateValue<boolean>) => setUiField('loading', value), [setUiField]);
  const setErrors = useCallback((value: SetStateValue<Record<string, string>>) => {
    uiDispatch({ type: 'SET_ERROR_MAP', errors: resolveStateValue(value, errors) });
  }, [errors]);
  const setSubmitting = useCallback((value: SetStateValue<boolean>) => setUiField('submitting', value), [setUiField]);

  const setShiftSuggestions = useCallback((value: SetStateValue<ShiftSuggestion[]>) => setShiftField('shiftSuggestions', value), [setShiftField]);
  const setLinkedShifts = useCallback((value: SetStateValue<LinkedShift[]>) => setShiftField('linkedShifts', value), [setShiftField]);
  const setShiftSegments = useCallback((value: SetStateValue<ShiftSegmentData[]>) => setShiftField('shiftSegments', value), [setShiftField]);
  const setSelectedSegmentId = useCallback((value: SetStateValue<string | null>) => setShiftField('selectedSegmentId', value), [setShiftField]);

  const formatDatetimeLocal = useCallback((date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, []);

  const formatTimeForLabel = (dateStr?: string) => {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const formatSegmentLabel = (segment: ShiftSegmentData, index: number) => {
      const serviceName = segment.service_type?.name || `区間 ${index + 1}`;
      return `${serviceName} ${formatTimeForLabel(segment.start_at)}〜${formatTimeForLabel(segment.end_at)}`;
  };

  const applySegmentDefaults = useCallback((segment: ShiftSegmentData) => {
      const s = new Date(segment.start_at);
      const e = new Date(segment.end_at);
      setIsSpanningMonth(false);
      setOriginalShiftTimes({ start_at: segment.start_at, end_at: segment.end_at });
      setStartDateTime(formatDatetimeLocal(s));
      setEndDateTime(formatDatetimeLocal(e));
      setServiceTime(((e.getTime() - s.getTime()) / (1000 * 60 * 60)).toString());
      const staffNames = (segment.shift_segment_staffs ?? [])
          .map((staff) => staff.staff?.name)
          .filter((name): name is string => Boolean(name));
      setActualServiceTypeId(segment.service_type_id ?? '');
      setActualStaffs((segment.shift_segment_staffs ?? []).map((staff) => ({
          staff_id: staff.staff_id,
          staff_role_id: staff.staff_role_id ?? null,
      })));
      setSelectedHelpers(staffNames);
      setSelectedSegmentId(segment.id);
      setCurrentStatus('draft');
  }, [formatDatetimeLocal, setActualServiceTypeId, setActualStaffs, setCurrentStatus, setEndDateTime, setIsSpanningMonth, setOriginalShiftTimes, setSelectedHelpers, setSelectedSegmentId, setServiceTime, setStartDateTime]);

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
  }, [formatDatetimeLocal, setEndDateTime, setServiceTime, setStartDateTime]);

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
    if (!currentOrg) return;

    try {
      const [
        { data: client },
        { data: tmpl },
        { data: staffsData },
        { data: assignmentRows },
        { data: officesData },
        { data: serviceTypeData },
        { data: staffRoleData },
      ] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).single(),
        supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle(),
        supabase
          .from('staffs')
          .select('id, name, user_id, office_id')
          .eq('organization_id', currentOrg.id)
          .is('archived_at', null)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true }),
        supabase
          .from('assignments')
          .select('staff_id, round_trip_distance_km')
          .eq('client_id', clientId),
        supabase
          .from('offices')
          .select('id, travel_cost_rate_yen_per_km')
          .eq('organization_id', currentOrg.id)
          .is('archived_at', null),
        supabase
          .from('service_types')
          .select('id, name')
          .eq('organization_id', currentOrg.id)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
        supabase
          .from('staff_roles')
          .select('id, name')
          .eq('organization_id', currentOrg.id)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
      ]);

      if (client) {
        setClientName(client.name);
        const schema = (tmpl?.schema as FormItem[]) || DEFAULT_TEMPLATE;
        setTemplate(schema.filter(i => !['service_time', 'travel_time', 'round_trip_distance_km', 'travel_cost_yen'].includes(i.id)));
      }

      const distanceByStaffId = new Map((assignmentRows || []).map((assignment) => [assignment.staff_id, Number(assignment.round_trip_distance_km || 0)]));
      const rateByOfficeId = new Map((officesData || []).map((office) => [office.id, Number(office.travel_cost_rate_yen_per_km)]));
      const allStaffs = (staffsData || []).map(s => ({
        id: s.id,
        name: s.name,
        user_id: s.user_id,
        defaultRoundTripDistanceKm: distanceByStaffId.get(s.id) || 0,
        // office_id が未設定、または所属事業所がアーカイブ済み（rateByOfficeIdに存在しない）の場合は20円/kmにフォールバック
        defaultTravelCostRateYenPerKm: (s.office_id && rateByOfficeId.get(s.office_id)) ?? 20,
      }));
      setSelectableStaffs(allStaffs);

      setServiceTypes((serviceTypeData ?? []) as ServiceTypeOption[]);
      setStaffRoles((staffRoleData ?? []) as StaffRoleOption[]);

      if (!currentReportId && !shiftId && userId) {
        const myStaffRecord = allStaffs.find(s => s.user_id === userId);
        if (myStaffRecord) {
            setSelectedHelpers([myStaffRecord.name]);
            setActualStaffs([{ staff_id: myStaffRecord.id, staff_role_id: null }]);
            setRoundTripDistanceKm(String(myStaffRecord.defaultRoundTripDistanceKm || 0));
            setTravelCostRateYenPerKm(myStaffRecord.defaultTravelCostRateYenPerKm);
        }
      }
    } catch (error) { console.error('Error fetching base data:', error); }
  }, [clientId, currentOrg, currentReportId, setActualStaffs, setClientName, setRoundTripDistanceKm, setSelectableStaffs, setSelectedHelpers, setServiceTypes, setStaffRoles, setTemplate, setTravelCostRateYenPerKm, shiftId, userId]);

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
      setSelectedSegmentId(r.segment_id ?? null);
      setActualServiceTypeId(r.actual_service_type_id ?? '');
      setIsDirty(false);

      const shiftPromise = (r.shift_id && !r.segment_id)
        ? supabase.from('shifts').select('start_at, end_at').eq('id', r.shift_id).maybeSingle()
        : Promise.resolve(null);

      const [
        shiftResult,
        { data: v, error: vError },
        { data: actualStaffRows, error: actualStaffError },
      ] = await Promise.all([
        shiftPromise,
        supabase.from('report_values').select('data').eq('report_id', targetId).maybeSingle(),
        supabase
          .from('report_actual_staffs')
          .select('staff_id, staff_role_id, staff:staffs(name)')
          .eq('report_id', targetId)
          .order('sort_order', { ascending: true }),
        currentOrg
          ? (async () => {
              try {
                await auditReportView(currentOrg.id, targetId);
                setImages(await getReportImages(currentOrg.id, targetId));
              } catch (auditImageError) {
                console.error('audit/image load error:', auditImageError);
              }
            })()
          : Promise.resolve(),
      ]);

      if (shiftResult?.data) {
          const shift = shiftResult.data;
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

      // ★修正: .single() だと行欠落/複数行でエラーになり全項目が空になるため maybeSingle に変更
      if (vError) console.error('report_values load error:', vError);
      const data = (v?.data || {}) as FormAnswers & { service_time?: string; travel_time?: string; round_trip_distance_km?: string; _helpers?: string[] };
      setServiceTime(data.service_time || '');
      setTravelTime(data.travel_time || '0');
      setRoundTripDistanceKm(data.round_trip_distance_km || '0');
      setTravelCostRateYenPerKm(Number(data.travel_cost_rate_yen_per_km || travelCostRateYenPerKm || 20));
      setDistanceTouched(false);
      if (actualStaffError) console.error('report_actual_staffs load error:', actualStaffError);
      const typedActualStaffRows = (actualStaffRows ?? []) as unknown as Array<{ staff_id: string; staff_role_id: string | null; staff?: { name: string } | { name: string }[] | null }>;
      if (typedActualStaffRows.length > 0) {
        setActualStaffs(typedActualStaffRows.map((staff) => ({ staff_id: staff.staff_id, staff_role_id: staff.staff_role_id ?? null })));
        setSelectedHelpers(typedActualStaffRows.map((staff) => {
          const nestedStaff = Array.isArray(staff.staff) ? staff.staff[0] : staff.staff;
          return nestedStaff?.name;
        }).filter((name): name is string => Boolean(name)));
      } else {
        setActualStaffs([]);
        setSelectedHelpers(data._helpers || []);
      }
      setAnswers(data);
    } catch (e) { console.error(e); showToast('記録の読み込みに失敗しました', 'error'); }
  }, [showToast, formatDatetimeLocal, currentOrg, setActualServiceTypeId, setActualStaffs, setAnswers, setCurrentStatus, setDistanceTouched, setEndDateTime, setImages, setIsDirty, setIsSpanningMonth, setOriginalShiftTimes, setRoundTripDistanceKm, setSelectedHelpers, setSelectedPart, setSelectedSegmentId, setServiceTime, setStartDateTime, setTravelCostRateYenPerKm, setTravelTime, travelCostRateYenPerKm]);

  useEffect(() => {
    if (currentReportId || distanceTouched || selectableStaffs.length === 0 || selectedHelpers.length === 0) return;
    const staff = selectableStaffs.find((helper) => helper.name === selectedHelpers[0]);
    if (staff) {
      setRoundTripDistanceKm(String(staff.defaultRoundTripDistanceKm || 0));
      setTravelCostRateYenPerKm(staff.defaultTravelCostRateYenPerKm ?? 20);
    }
  }, [currentReportId, distanceTouched, selectableStaffs, selectedHelpers, setRoundTripDistanceKm, setTravelCostRateYenPerKm]);

  useEffect(() => {
    const init = async () => {
      let targetId = paramReportId;
      setSelectedSegmentId(segmentId);

      if (shiftId && !paramReportId) {
          const { data: shiftData } = await supabase
              .from('shifts')
              .select(`
                  start_at, end_at,
                  shift_staffs (
                      staff_id,
                      staffs (name)
                  ),
                  shift_segments (
                      id,
                      service_type_id,
                      start_at,
                      end_at,
                      sort_order,
                      service_type:service_types ( id, name ),
                      shift_segment_staffs (
                          staff_id,
                          staff_role_id,
                          staff:staffs ( name )
                      )
                  )
              `)
              .eq('id', shiftId)
              .single();

          const typedSegments = (((shiftData?.shift_segments as unknown as ShiftSegmentData[]) ?? [])
              .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()));
          setShiftSegments(typedSegments);

          const effectiveSegmentId = segmentId || (typedSegments.length === 1 ? typedSegments[0].id : null);
          if (typedSegments.length === 1 && !segmentId) {
              router.replace(`/app/record/${clientId}?shiftId=${shiftId}&segmentId=${typedSegments[0].id}`);
          }

          if (effectiveSegmentId) {
              const { data: existingReport } = await supabase
                  .from('reports')
                  .select('id')
                  .eq('shift_id', shiftId)
                  .eq('segment_id', effectiveSegmentId)
                  .is('deleted_at', null)
                  .maybeSingle();

              if (existingReport) {
                  targetId = existingReport.id;
                  setCurrentReportId(targetId);
                  router.replace(`/app/record/${clientId}?reportId=${targetId}&shiftId=${shiftId}&segmentId=${effectiveSegmentId}`);
                  showToast('この区間にはすでに記録が存在します。該当する記録を開きました。', 'info');
              } else {
                  const targetSegment = typedSegments.find((segment) => segment.id === effectiveSegmentId);
                  if (targetSegment) applySegmentDefaults(targetSegment);
              }
          } else if (typedSegments.length > 1) {
              setCurrentStatus('draft');
          } else {
              const { data: existingReport } = await supabase
                  .from('reports')
                  .select('id')
                  .eq('shift_id', shiftId)
                  .is('segment_id', null)
                  .is('deleted_at', null)
                  .maybeSingle();

              if (existingReport) {
                  targetId = existingReport.id;
                  setCurrentReportId(targetId);
                  router.replace(`/app/record/${clientId}?reportId=${targetId}&shiftId=${shiftId}`);
                  showToast('このシフトにはすでに記録が存在します。該当する記録を開きました。', 'info');
              } else if (shiftData) {
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
                  setActualStaffs(typedShiftStaffs.map((staff) => ({ staff_id: staff.staff_id, staff_role_id: null })));
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
  }, [wsLoading, currentOrg, paramReportId, shiftId, segmentId, clientId, router, showToast, fetchBaseData, loadExistingData, formatDatetimeLocal, setupTimeForPart, applySegmentDefaults, setActualStaffs, setCurrentReportId, setCurrentStatus, setEndDateTime, setIsSpanningMonth, setLoading, setOriginalShiftTimes, setSelectedHelpers, setSelectedSegmentId, setServiceTime, setShiftSegments, setStartDateTime]);

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
  }, [currentReportId, currentOrg, setLinkedShifts, setShiftSuggestions]);

  const handleChange = useCallback((setter: (val: string) => void, val: string) => {
    setter(val);
    uiDispatch({ type: 'MARK_DIRTY' });
  }, []);

  const handleAnswerChange = useCallback((id: string, value: FormAnswers[string]) => {
    formDispatch({ type: 'SET_ANSWER', id, value });
    uiDispatch({ type: 'MARK_DIRTY' });
    uiDispatch({ type: 'CLEAR_ERROR', id });
  }, []);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [currentOrg, currentReportId, loadExistingData, setSubmitting, showToast]);

  const handleDeleteReport = useCallback(async () => {
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
  }, [confirm, currentOrg, currentReportId, currentStatus, router, showToast]);

  const validate = useCallback(() => {
    const ne: Record<string, string> = {};
    if (!serviceTime) ne['serviceTime'] = '必須項目です';
    if (selectedHelpers.length === 0) ne['helpers'] = '担当スタッフを選択してください';
    if (actualStaffs.length !== selectedHelpers.length) ne['helpers'] = '担当スタッフをスタッフ名簿から選択してください';
    template.forEach(item => {
      const val = answers[item.id];
      if (item.required && (!val || (Array.isArray(val) && val.length === 0))) ne[item.id] = '必須項目です';
    });
    setErrors(ne);
    return Object.keys(ne).length === 0;
  }, [actualStaffs.length, answers, selectedHelpers.length, serviceTime, setErrors, template]);

  const saveReport = useCallback(async (status: ReportStatus, skipValidation = false) => {
    if (shiftId && shiftSegments.length > 0 && !selectedSegmentId) {
      showToast('記録を作成する前にサービス区間を選択してください', 'warning');
      return false;
    }
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
        segmentId: selectedSegmentId || segmentId || null,
        actualServiceTypeId: actualServiceTypeId || null,
        actualStaffs,
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
  }, [actualServiceTypeId, actualStaffs, answers, clientId, currentOrg, currentReportId, endDateTime, hasAiDraftSource, roundTripDistanceKm, router, segmentId, selectedHelpers, selectedSegmentId, serviceTime, setCurrentReportId, setHasAiDraftSource, setIsDirty, setSubmitting, shiftId, shiftSegments.length, showToast, startDateTime, travelCostRateYenPerKm, travelTime, validate]);

  const handleDraftSave = useCallback(async () => { if (await saveReport('draft', true)) { showToast('下書きを保存しました', 'success'); } }, [saveReport, showToast]);
  const handleSubmit = useCallback(async () => {
      if (!(await confirm({ title: '送信の確認', message: '記録を送信しますか？', confirmText: '送信する' }))) return;
      if (await saveReport('pending')) { showToast('記録を送信しました', 'success'); router.push('/app/record'); }
  }, [confirm, router, saveReport, showToast]);
  const executeApprove = useCallback(async () => {
      if (await saveReport('approved')) {
          showToast('承認しました', 'success');
          router.push('/app/reports');
      }
  }, [router, saveReport, showToast]);
  const handleApprove = useCallback(async () => {
      if (!(await confirm({ title: '承認の確認', message: 'この記録を承認しますか？', confirmText: '承認する', confirmColor: 'primary' }))) return;
      await executeApprove();
  }, [confirm, executeApprove]);
  const executeRemand = useCallback(async () => {
      if (await saveReport('remanded')) {
          showToast('記録を差し戻しました', 'info');
          router.push('/app/reports');
      }
  }, [router, saveReport, showToast]);
  const handleRemand = useCallback(async () => {
      if (!(await confirm({ title: '承認取消の確認', message: '承認を取り消し、差し戻しますか？', confirmText: '差し戻す', confirmColor: 'warning' }))) return;
      await executeRemand();
  }, [confirm, executeRemand]);

  const handleClose = useCallback(() => { if (isDirty) setOpenCloseDialog(true); else router.back(); }, [isDirty, router, setOpenCloseDialog]);
  const handleDialogDiscard = useCallback(() => { setOpenCloseDialog(false); router.back(); }, [router, setOpenCloseDialog]);
  const handleDialogSaveDraft = useCallback(async () => { if (await saveReport('draft', true)) { showToast('下書き保存しました'); router.back(); } setOpenCloseDialog(false); }, [router, saveReport, setOpenCloseDialog, showToast]);

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
  }, [formatDatetimeLocal, selectableStaffs, setAiFilledFields, setAnswers, setEndDateTime, setHasAiDraftSource, setIsDirty, setSelectedHelpers, setServiceTime, setStartDateTime]);

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
  const requiresSegmentSelection = Boolean(shiftId && shiftSegments.length > 1 && !selectedSegmentId && !currentReportId);
  const aiClients = useMemo(() => [{ id: clientId as string, name: clientName }], [clientId, clientName]);
  const aiHelpers = useMemo(() => selectableStaffs.map(s => ({ id: s.id, name: s.name })), [selectableStaffs]);

  const handleStaffChange = useCallback((value: string[]) => {
      setSelectedHelpers(value);
      setActualStaffs(value.map((name) => {
          const staff = selectableStaffs.find((helper) => helper.name === name);
          const existing = staff ? actualStaffs.find((actualStaff) => actualStaff.staff_id === staff.id) : null;
          return staff ? { staff_id: staff.id, staff_role_id: existing?.staff_role_id ?? null } : null;
      }).filter((staff): staff is ActualStaffInput => Boolean(staff)));
      if (!currentReportId && !distanceTouched) {
          const staff = selectableStaffs.find((helper) => helper.name === value[0]);
          if (staff) {
            setRoundTripDistanceKm(String(staff.defaultRoundTripDistanceKm || 0));
            setTravelCostRateYenPerKm(staff.defaultTravelCostRateYenPerKm ?? 20);
          }
      }
      setIsDirty(true);
      if (errors.helpers) {
          const newErrors = { ...errors };
          delete newErrors.helpers;
          setErrors(newErrors);
      }
  }, [actualStaffs, currentReportId, distanceTouched, errors, selectableStaffs, setActualStaffs, setErrors, setIsDirty, setRoundTripDistanceKm, setSelectedHelpers, setTravelCostRateYenPerKm]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 10 }}><CircularProgress /></Box>;

  return (
    <PageLayout>
       <InnerPageHeader
            icon={<IconButton edge="start" onClick={handleClose} sx={{ color: 'action.active' }}><CloseIcon /></IconButton>}
            title={currentReportId ? (isAdmin && currentStatus === 'pending' ? '記録の確認・承認' : (currentStatus === 'approved' ? '承認済の記録' : '記録を修正')) : `${clientName} 様`}
            actions={(
            <Stack direction="row" spacing={1} useFlexGap flexWrap="nowrap" justifyContent="flex-end" sx={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
                {currentReportId && currentStatus !== 'approved' && canDeleteRecord && (
                    <IconButton color="error" onClick={handleDeleteReport} disabled={submitting}><DeleteIcon /></IconButton>
                )}
                
                {isAdmin && currentStatus === 'pending' && <Button variant="contained" color="success" size="small" startIcon={<CheckCircleIcon />} onClick={handleApprove} disabled={submitting || requiresSegmentSelection}>承認</Button>}
                {isAdmin && currentStatus === 'approved' && <Button variant="contained" color="warning" size="small" startIcon={<AssignmentReturnIcon />} onClick={handleRemand} disabled={submitting || requiresSegmentSelection}>承認取消</Button>}
                {(!isAdmin || currentStatus !== 'pending') && currentStatus !== 'approved' && (
                    <>
                        <Button variant="outlined" size="small" startIcon={<SaveIcon />} onClick={handleDraftSave} disabled={submitting || requiresSegmentSelection}>下書き</Button>
                        <Button variant="contained" size="small" startIcon={<SendIcon />} onClick={handleSubmit} disabled={submitting || requiresSegmentSelection} sx={{ fontWeight: 'bold' }}>送信</Button>
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

            {shiftId && shiftSegments.length > 1 && !selectedSegmentId && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    このシフトには複数のサービス区間があります。以下から区間を選択して記録を作成してください。
                </Alert>
            )}

            {shiftId && shiftSegments.length > 1 && !currentReportId && (
                <Alert severity={requiresSegmentSelection ? 'info' : 'success'}>
                    <Stack spacing={1}>
                        <Typography variant="subtitle2" fontWeight="bold">
                            記録を作成する区間を選択してください
                        </Typography>
                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                            {shiftSegments.map((segment, index) => (
                                <Button
                                    key={segment.id}
                                    size="small"
                                    variant={(selectedSegmentId || segmentId) === segment.id ? 'contained' : 'outlined'}
                                    onClick={() => router.replace(`/app/record/${clientId}?shiftId=${shiftId}&segmentId=${segment.id}`)}
                                >
                                    {formatSegmentLabel(segment, index)}
                                </Button>
                            ))}
                        </Stack>
                    </Stack>
                </Alert>
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
                        <Button size="small" onClick={() => shiftDispatch({ type: 'DISMISS_SUGGESTION', id: suggestion.id })}>無視する</Button>
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
                  clients={aiClients}
                  helpers={aiHelpers}
                  onExtracted={handleAiExtracted}
                  hasExistingValues={Object.keys(answers).length > 0}
                  disabled={submitting || loading || !currentOrg || requiresSegmentSelection}
                />
              </Box>
            )}

            <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1, bgcolor: 'background.paper' }}>
                <Stack spacing={3}>

                <Box sx={{ p: 1, mx: -1, borderRadius: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom>
                        実績サービス種別
                    </Typography>
                    <TextField
                        select
                        fullWidth
                        label="実績サービス種別"
                        value={actualServiceTypeId}
                        onChange={(e) => {
                            setActualServiceTypeId(e.target.value);
                            setIsDirty(true);
                        }}
                        helperText="予定と異なる場合は実際に提供したサービス種別を選択してください"
                    >
                        <MenuItem value="">未設定</MenuItem>
                        {serviceTypes.map((serviceType) => (
                            <MenuItem key={serviceType.id} value={serviceType.id}>{serviceType.name}</MenuItem>
                        ))}
                    </TextField>
                </Box>

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
                    {actualStaffs.length > 0 && (
                        <Stack spacing={1.5} mt={2}>
                            {actualStaffs.map((actualStaff) => {
                                const staff = selectableStaffs.find((helper) => helper.id === actualStaff.staff_id);
                                return (
                                    <Stack key={actualStaff.staff_id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                                        <Typography variant="body2" sx={{ minWidth: 140, fontWeight: 'bold' }}>
                                            {staff?.name ?? '担当スタッフ'}
                                        </Typography>
                                        <TextField
                                            select
                                            size="small"
                                            fullWidth
                                            label="実績役割"
                                            value={actualStaff.staff_role_id ?? ''}
                                            onChange={(e) => {
                                                setActualStaffs((prev) => prev.map((item) => (
                                                    item.staff_id === actualStaff.staff_id
                                                        ? { ...item, staff_role_id: e.target.value || null }
                                                        : item
                                                )));
                                                setIsDirty(true);
                                            }}
                                        >
                                            <MenuItem value="">未設定</MenuItem>
                                            {staffRoles.map((role) => (
                                                <MenuItem key={role.id} value={role.id}>{role.name}</MenuItem>
                                            ))}
                                        </TextField>
                                    </Stack>
                                );
                            })}
                        </Stack>
                    )}
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
                    {section.items.map((item) => (
                        <FormFieldItem
                          key={item.id}
                          item={item}
                          value={answers[item.id]}
                          detailValue={String(answers[`${item.id}_detail`] ?? '')}
                          error={errors[item.id]}
                          isAiFilled={aiFilledFields.has(item.id)}
                          onAnswerChange={handleAnswerChange}
                        />
                    ))}
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
