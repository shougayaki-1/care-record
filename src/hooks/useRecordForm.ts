'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import {
  auditReportView,
  discardReportAutosave,
  getReportImages,
  loadReportAutosave,
  saveReportAutosave,
  saveReport as saveReportAction,
  softDeleteReports,
  transitionReports,
  uploadReportImage,
} from '@/app/actions/reports';
import { getLinkedShifts, getShiftSuggestions } from '@/app/actions/reportShifts';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRequestGeneration } from '@/hooks/useRequestGeneration';
import { supabase } from '@/lib/supabase';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import { checkRecordPermission } from '@/utils/permissions';

export type FormItem = {
  id: string; label: string; type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string; required: boolean; hasDetail?: boolean;
  detailMode?: 'conditional' | 'always'; detailLabel?: string;
};

export type FormAnswers = Record<string, string | number | boolean | string[]>;
export type HelperProfile = { id: string; name: string; defaultRoundTripDistanceKm?: number };
export type StaffRoleOption = { id: string; name: string };
export type ServiceTypeOption = { id: string; name: string };
export type ActualStaffInput = { staff_id: string; staff_role_id: string | null };
type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';

type ShiftStaffData = {
    staff_id: string;
    staffs: { name: string } | null;
};

export type ShiftSegmentData = {
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

export type ShiftSuggestion = { id: string; title: string | null; start_at: string; end_at: string; staffName: string | null };
export type LinkedShift = { shift_id: string; is_primary: boolean; shifts: { id: string; title: string | null; start_at: string; end_at: string; shift_staffs: Array<{ staffs: { name: string } | null }> } | null };

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
  | { type: 'RESET' }
  | { type: 'CLEAR_ANSWERS' }
  | { type: 'AI_FILL'; answers: FormAnswers; fields: Set<string> };

type UiAction =
  | { type: 'SET_FIELD'; field: keyof UiState; value: SetStateValue<unknown> }
  | { type: 'RESET'; currentReportId: string | null }
  | { type: 'MARK_DIRTY'; dirty?: boolean }
  | { type: 'SET_ERROR_MAP'; errors: Record<string, string> }
  | { type: 'CLEAR_ERROR'; id: string };

type ShiftAction =
  | { type: 'SET_FIELD'; field: keyof ShiftState; value: SetStateValue<unknown> }
  | { type: 'RESET'; selectedSegmentId: string | null }
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
    case 'RESET':
      return formInitialState;
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
    case 'RESET':
      return createUiInitialState(action.currentReportId);
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
    case 'RESET':
      return createShiftInitialState(action.selectedSegmentId);
    case 'DISMISS_SUGGESTION':
      return { ...state, dismissedSuggestions: new Set([...state.dismissedSuggestions, action.id]) };
    default:
      return state;
  }
}

export function useRecordForm() {
  const router = useRouter();
  const { clientId } = useParams();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { currentOrg, loading: wsLoading, userId } = useWorkspace();
  
  const paramReportId = searchParams.get('reportId');
  const shiftId = searchParams.get('shiftId');
  const segmentId = searchParams.get('segmentId');
  const incomingDraftKey = searchParams.get('draftKey');
  const recordIdentityKey = `${currentOrg?.id ?? ''}:${clientId ?? ''}:${paramReportId ?? ''}:${shiftId ?? ''}:${segmentId ?? ''}`;
  const draftScope = useMemo(
    () => ({ identity: recordIdentityKey, key: incomingDraftKey || crypto.randomUUID() }),
    [incomingDraftKey, recordIdentityKey],
  );
  const draftKey = draftScope.key;
  const recordScopeKey = `${recordIdentityKey}:${draftKey}`;
  const autosaveRestoredRef = useRef(false);
  const autosaveRevisionRef = useRef(0);
  const contentVersionRef = useRef(0);
  const { next: nextLoadGeneration, invalidate: invalidateLoadGeneration, isCurrent: isCurrentLoadGeneration } = useRequestGeneration();
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

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
  const travelCostRateRef = useRef(travelCostRateYenPerKm);

  useEffect(() => {
    travelCostRateRef.current = travelCostRateYenPerKm;
  }, [travelCostRateYenPerKm]);

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

  useEffect(() => {
    // Fallback for direct/deep-link loads that reach this page without a
    // draftKey (e.g. a typed URL or bookmark) — every in-app navigation to
    // this page goes through buildRecordPath() (src/utils/recordNavigation.ts),
    // which already includes draftKey, so this replace() never races a
    // pending router.push for those paths.
    if (searchParams.get('draftKey')) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('draftKey', draftKey);
    router.replace(`/app/record/${clientId}?${next.toString()}`);
  }, [clientId, draftKey, router, searchParams]);

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
          router.replace(`/app/record/${clientId}?reportId=${existing.id}&shiftId=${shiftId}&draftKey=${encodeURIComponent(draftKey)}`);
          await loadExistingData(existing.id);
      } else {
          setCurrentReportId(null);
          router.replace(`/app/record/${clientId}?shiftId=${shiftId}&draftKey=${encodeURIComponent(draftKey)}`);
          setupTimeForPart(part, originalShiftTimes.start_at, originalShiftTimes.end_at);
          setAnswers({});
          setCurrentStatus('draft');
      }
  };

  const fetchBaseData = useCallback(async (isCurrent: () => boolean, hasExistingReport: boolean) => {
    if (!currentOrg || typeof clientId !== 'string') return;

    try {
      const [
        { data: client },
        { data: tmpl },
        { data: staffsData },
        { data: assignmentRows },
        { data: orgData },
        { data: serviceTypeData },
        { data: staffRoleData },
      ] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).single(),
        supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle(),
        supabase
          .from('staffs')
          .select('id, name, user_id')
          .eq('organization_id', currentOrg.id)
          .is('archived_at', null)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true }),
        supabase
          .from('assignments')
          .select('staff_id, round_trip_distance_km')
          .eq('client_id', clientId),
        supabase
          .from('organizations')
          .select('travel_cost_rate_yen_per_km')
          .eq('id', currentOrg.id)
          .maybeSingle(),
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

      if (!isCurrent()) return;

      if (client) {
        setClientName(client.name);
        const schema = (tmpl?.schema as FormItem[]) || DEFAULT_TEMPLATE;
        setTemplate(schema.filter(i => !['service_time', 'travel_time', 'round_trip_distance_km', 'travel_cost_yen'].includes(i.id)));
      }

      const distanceByStaffId = new Map((assignmentRows || []).map((assignment) => [assignment.staff_id, Number(assignment.round_trip_distance_km || 0)]));
      const allStaffs = (staffsData || []).map(s => ({ id: s.id, name: s.name, user_id: s.user_id, defaultRoundTripDistanceKm: distanceByStaffId.get(s.id) || 0 }));
      setSelectableStaffs(allStaffs);

      setTravelCostRateYenPerKm(Number(orgData?.travel_cost_rate_yen_per_km ?? 20));
      setServiceTypes((serviceTypeData ?? []) as ServiceTypeOption[]);
      setStaffRoles((staffRoleData ?? []) as StaffRoleOption[]);

      if (!hasExistingReport && !shiftId && userId) {
        const myStaffRecord = allStaffs.find(s => s.user_id === userId);
        if (myStaffRecord) {
            setSelectedHelpers([myStaffRecord.name]);
            setActualStaffs([{ staff_id: myStaffRecord.id, staff_role_id: null }]);
            setRoundTripDistanceKm(String(myStaffRecord.defaultRoundTripDistanceKm || 0));
        }
      }
    } catch (error) { console.error('Error fetching base data:', error); }
  }, [clientId, currentOrg, setActualStaffs, setClientName, setRoundTripDistanceKm, setSelectableStaffs, setSelectedHelpers, setServiceTypes, setStaffRoles, setTemplate, setTravelCostRateYenPerKm, shiftId, userId]);

  const loadExistingData = useCallback(async (targetId: string, isCurrent: () => boolean = () => true) => {
    if (!targetId) return;
    try {
      // ★修正: reports と shifts には外部キーが無く埋め込み(shifts(...))が400になるため、shift_id で別途取得する
      const { data: r, error: rError } = await supabase.from('reports').select('*').eq('id', targetId).is('deleted_at', null).maybeSingle();
      if (rError) throw rError;
      if (!isCurrent()) return;
      if (!r || !r.start_at || !r.end_at) { showToast('記録が見つからないか、日時が不正です', 'error'); return; }

      // ★修正: report_values が無い/読めない場合でも、基本情報（日時・ステータス）は表示する
      setStartDateTime(formatDatetimeLocal(new Date(r.start_at)));
      setEndDateTime(formatDatetimeLocal(new Date(r.end_at)));
      setCurrentStatus((r.status ?? 'draft') as ReportStatus);
      contentVersionRef.current = Number(r.current_version ?? 0);
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
                const nextImages = await getReportImages(currentOrg.id, targetId);
                if (isCurrent()) setImages(nextImages);
              } catch (auditImageError) {
                console.error('audit/image load error:', auditImageError);
              }
            })()
          : Promise.resolve(),
      ]);

      if (!isCurrent()) return;

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
      setTravelCostRateYenPerKm(Number(data.travel_cost_rate_yen_per_km || travelCostRateRef.current || 20));
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
    } catch (e) {
      if (!isCurrent()) return;
      console.error(e);
      showToast('記録の読み込みに失敗しました', 'error');
    }
  }, [showToast, formatDatetimeLocal, currentOrg, setActualServiceTypeId, setActualStaffs, setAnswers, setCurrentStatus, setDistanceTouched, setEndDateTime, setImages, setIsDirty, setIsSpanningMonth, setOriginalShiftTimes, setRoundTripDistanceKm, setSelectedHelpers, setSelectedPart, setSelectedSegmentId, setServiceTime, setStartDateTime, setTravelCostRateYenPerKm, setTravelTime]);

  useEffect(() => {
    if (currentReportId || distanceTouched || selectableStaffs.length === 0 || selectedHelpers.length === 0) return;
    const staff = selectableStaffs.find((helper) => helper.name === selectedHelpers[0]);
    if (staff) setRoundTripDistanceKm(String(staff.defaultRoundTripDistanceKm || 0));
  }, [currentReportId, distanceTouched, selectableStaffs, selectedHelpers, setRoundTripDistanceKm]);

  useEffect(() => {
    autosaveRestoredRef.current = false;
    autosaveRevisionRef.current = 0;
    contentVersionRef.current = 0;
  }, [recordScopeKey]);

  useEffect(() => {
    const generation = nextLoadGeneration();
    const isCurrent = () => isCurrentLoadGeneration(generation);
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

          if (!isCurrent()) return;

          const typedSegments = (((shiftData?.shift_segments as unknown as ShiftSegmentData[]) ?? [])
              .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()));
          setShiftSegments(typedSegments);

          const effectiveSegmentId = segmentId || (typedSegments.length === 1 ? typedSegments[0].id : null);
          if (typedSegments.length === 1 && !segmentId) {
              router.replace(`/app/record/${clientId}?shiftId=${shiftId}&segmentId=${typedSegments[0].id}&draftKey=${encodeURIComponent(draftKey)}`);
          }

          if (effectiveSegmentId) {
              const { data: existingReport } = await supabase
                  .from('reports')
                  .select('id')
                  .eq('shift_id', shiftId)
                  .eq('segment_id', effectiveSegmentId)
                  .is('deleted_at', null)
                  .maybeSingle();

              if (!isCurrent()) return;

              if (existingReport) {
                  targetId = existingReport.id;
                  setCurrentReportId(targetId);
                  router.replace(`/app/record/${clientId}?reportId=${targetId}&shiftId=${shiftId}&segmentId=${effectiveSegmentId}&draftKey=${encodeURIComponent(draftKey)}`);
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

              if (!isCurrent()) return;

              if (existingReport) {
                  targetId = existingReport.id;
                  setCurrentReportId(targetId);
                  router.replace(`/app/record/${clientId}?reportId=${targetId}&shiftId=${shiftId}&draftKey=${encodeURIComponent(draftKey)}`);
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

      await fetchBaseData(isCurrent, Boolean(targetId));
      if (!isCurrent()) return;
      if (targetId) {
          await loadExistingData(targetId, isCurrent);
      }
      if (!isCurrent()) return;
      setLoading(false);
    };

    formDispatch({ type: 'RESET' });
    uiDispatch({ type: 'RESET', currentReportId: paramReportId });
    shiftDispatch({ type: 'RESET', selectedSegmentId: segmentId });
    if (!wsLoading && currentOrg) {
      void init();
    }
    return () => {
      if (isCurrent()) invalidateLoadGeneration();
    };
  }, [wsLoading, currentOrg, paramReportId, shiftId, segmentId, clientId, draftKey, router, showToast, fetchBaseData, loadExistingData, formatDatetimeLocal, setupTimeForPart, applySegmentDefaults, invalidateLoadGeneration, isCurrentLoadGeneration, nextLoadGeneration, setActualStaffs, setCurrentReportId, setCurrentStatus, setEndDateTime, setIsSpanningMonth, setLoading, setOriginalShiftTimes, setSelectedHelpers, setSelectedSegmentId, setServiceTime, setShiftSegments, setStartDateTime]);

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

  // Recover private server-side work in progress. It is intentionally not kept
  // in localStorage because this screen can contain sensitive care information.
  useEffect(() => {
    if (loading || !currentOrg || autosaveRestoredRef.current || currentStatus === 'approved') return;
    let cancelled = false;
    autosaveRestoredRef.current = true;
    void loadReportAutosave(currentOrg.id, draftKey).then((saved) => {
      if (cancelled) return;
      if (!saved?.payload) return;
      const payload = saved.payload as Partial<{
        answers: FormAnswers;
        selectedHelpers: string[];
        actualStaffs: ActualStaffInput[];
        actualServiceTypeId: string;
        startDateTime: string;
        endDateTime: string;
        serviceTime: string;
        travelTime: string;
        roundTripDistanceKm: string;
      }>;
      if (payload.answers) setAnswers(payload.answers);
      if (payload.selectedHelpers) setSelectedHelpers(payload.selectedHelpers);
      if (payload.actualStaffs) setActualStaffs(payload.actualStaffs);
      if (payload.actualServiceTypeId !== undefined) setActualServiceTypeId(payload.actualServiceTypeId);
      if (payload.startDateTime) setStartDateTime(payload.startDateTime);
      if (payload.endDateTime) setEndDateTime(payload.endDateTime);
      if (payload.serviceTime !== undefined) setServiceTime(payload.serviceTime);
      if (payload.travelTime !== undefined) setTravelTime(payload.travelTime);
      if (payload.roundTripDistanceKm !== undefined) setRoundTripDistanceKm(payload.roundTripDistanceKm);
      autosaveRevisionRef.current = saved.autosave_revision ?? 0;
      setIsDirty(true);
      setAutosaveState('saved');
      showToast('入力途中の内容を復元しました', 'info');
    }).catch((error) => {
      if (cancelled) return;
      console.error('Failed to restore report autosave', error);
    });
    return () => {
      cancelled = true;
    };
  }, [currentOrg, currentStatus, draftKey, loading, recordScopeKey, setActualServiceTypeId, setActualStaffs, setAnswers, setEndDateTime, setIsDirty, setRoundTripDistanceKm, setSelectedHelpers, setServiceTime, setStartDateTime, setTravelTime, showToast]);

  useEffect(() => {
    if (!isDirty || loading || !currentOrg || currentStatus === 'approved') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const revision = autosaveRevisionRef.current + 1;
      setAutosaveState('saving');
      void saveReportAutosave({
        organizationId: currentOrg.id,
        clientId: clientId as string,
        reportId: currentReportId,
        draftKey,
        autosaveRevision: revision,
        payload: {
          answers,
          selectedHelpers,
          actualStaffs,
          actualServiceTypeId,
          startDateTime,
          endDateTime,
          serviceTime,
          travelTime,
          roundTripDistanceKm,
        },
      }).then((result) => {
        if (cancelled) return;
        if (result.saved) autosaveRevisionRef.current = revision;
        setAutosaveState('saved');
      }).catch((error) => {
        if (cancelled) return;
        console.error('Report autosave failed', error);
        setAutosaveState('error');
      });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actualServiceTypeId, actualStaffs, answers, clientId, currentOrg, currentReportId, currentStatus, draftKey, endDateTime, isDirty, loading, recordScopeKey, roundTripDistanceKm, selectedHelpers, serviceTime, startDateTime, travelTime]);

  useEffect(() => {
    if (!currentReportId || !currentOrg) return;
    let cancelled = false;
    void Promise.all([
      getLinkedShifts(currentReportId),
      getShiftSuggestions(currentOrg.id, currentReportId),
    ]).then(([linked, suggestions]) => {
      if (cancelled) return;
      setLinkedShifts(linked as LinkedShift[]);
      setShiftSuggestions(suggestions);
    }).catch((error) => {
      if (!cancelled) console.error('Failed to load linked shifts or suggestions', error);
    });
    return () => {
      cancelled = true;
    };
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

  const handleImageUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
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
        expectedVersion: contentVersionRef.current,
        idempotencyKey: crypto.randomUUID(),
        ...(status === 'draft' && hasAiDraftSource
          ? { auditSource: 'ai_import' as const, auditFileCount: 1 }
          : {}),
      });
      const targetReportId = result.reportId;
      contentVersionRef.current = result.version;
      if (!currentReportId) setCurrentReportId(targetReportId);
      if (status === 'draft') setHasAiDraftSource(false);
      setIsDirty(false);
      void discardReportAutosave(currentOrg.id, draftKey).catch((error) => {
        console.error('Failed to discard committed autosave', error);
      });
      setAutosaveState('idle');
      
      if (!currentReportId && targetReportId) {
          const newUrl = `/app/record/${clientId}?reportId=${targetReportId}&draftKey=${encodeURIComponent(draftKey)}`;
          router.replace(newUrl);
      }

      return true;
    } catch (e) {
      console.error(e);
      const message = e instanceof Error && e.message.startsWith('REPORT_VERSION_CONFLICT:')
        ? '他の利用者がこの記録を更新しました。入力内容は保持しています。再読み込みして差分を確認してください。'
        : 'エラーが発生しました';
      showToast(message, 'error');
      return false;
    }
    finally { setSubmitting(false); }
  }, [actualServiceTypeId, actualStaffs, answers, clientId, currentOrg, currentReportId, draftKey, endDateTime, hasAiDraftSource, roundTripDistanceKm, router, segmentId, selectedHelpers, selectedSegmentId, serviceTime, setCurrentReportId, setHasAiDraftSource, setIsDirty, setSubmitting, shiftId, shiftSegments.length, showToast, startDateTime, travelCostRateYenPerKm, travelTime, validate]);

  const handleDraftSave = useCallback(async () => { if (await saveReport('draft', true)) { showToast('下書きを保存しました', 'success'); } }, [saveReport, showToast]);
  const handleSubmit = useCallback(async () => {
      if (!(await confirm({ title: '送信の確認', message: '記録を送信しますか？', confirmText: '送信する' }))) return;
      if (await saveReport('pending')) { showToast('記録を送信しました', 'success'); router.push('/app/record'); }
  }, [confirm, router, saveReport, showToast]);
  const handlePendingSave = useCallback(async () => {
      if (await saveReport('pending')) {
        showToast('承認待ちのまま変更を保存しました', 'success');
      }
  }, [saveReport, showToast]);
  const executeApprove = useCallback(async () => {
      if (!currentOrg || !currentReportId) return;
      try {
        await transitionReports(currentOrg.id, [currentReportId], 'approve');
          showToast('承認しました', 'success');
          router.push('/app/reports');
      } catch (error) {
          console.error(error);
          showToast('承認に失敗しました', 'error');
      }
  }, [currentOrg, currentReportId, router, showToast]);
  const handleApprove = useCallback(async () => {
      if (!(await confirm({ title: '承認の確認', message: 'この記録を承認しますか？', confirmText: '承認する', confirmColor: 'primary' }))) return;
      await executeApprove();
  }, [confirm, executeApprove]);
  const executeRemand = useCallback(async () => {
      if (!currentOrg || !currentReportId) return;
      try {
        await transitionReports(currentOrg.id, [currentReportId], 'remand');
          showToast('記録を差し戻しました', 'info');
          router.push('/app/reports');
      } catch (error) {
          console.error(error);
          showToast('差し戻しに失敗しました', 'error');
      }
  }, [currentOrg, currentReportId, router, showToast]);
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
  const isReadOnly = currentStatus === 'approved';
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
          if (staff) setRoundTripDistanceKm(String(staff.defaultRoundTripDistanceKm || 0));
      }
      setIsDirty(true);
      if (errors.helpers) {
          const newErrors = { ...errors };
          delete newErrors.helpers;
          setErrors(newErrors);
      }
  }, [actualStaffs, currentReportId, distanceTouched, errors, selectableStaffs, setActualStaffs, setErrors, setIsDirty, setRoundTripDistanceKm, setSelectedHelpers]);

  const dismissShiftSuggestion = useCallback((id: string) => {
    shiftDispatch({ type: 'DISMISS_SUGGESTION', id });
  }, []);


  return {
    router, showToast, currentOrg, clientId, shiftId, segmentId,
    autosaveState, clientName, template, answers, selectableStaffs, staffRoles, serviceTypes,
    selectedHelpers, actualStaffs, actualServiceTypeId, startDateTime, endDateTime,
    serviceTime, travelTime, roundTripDistanceKm, travelCostRateYenPerKm, images,
    aiFilledFields, isSpanningMonth, selectedPart, originalShiftTimes,
    currentReportId, currentStatus, isDirty, openCloseDialog, loading, errors, submitting,
    shiftSuggestions, linkedShifts, dismissedSuggestions, shiftSegments, selectedSegmentId,
    setShiftSuggestions, setLinkedShifts, setSelectedSegmentId, dismissShiftSuggestion,
    setActualServiceTypeId, setActualStaffs, setStartDateTime, setEndDateTime,
    setServiceTime, setTravelTime, setRoundTripDistanceKm, setTravelCostRateYenPerKm,
    setDistanceTouched, setIsDirty, setOpenCloseDialog,
    formatTimeForLabel, formatSegmentLabel, handlePartChange, handleChange, handleAnswerChange,
    handleImageUpload, handleDeleteReport, handleDraftSave, handleSubmit, handlePendingSave,
    handleApprove, handleRemand, handleClose, handleDialogDiscard, handleDialogSaveDraft,
    handleAiExtracted, groupedSections, isAdmin, isReadOnly, canDeleteRecord, travelCostYen,
    requiresSegmentSelection, aiClients, aiHelpers, handleStaffChange,
  };
}
