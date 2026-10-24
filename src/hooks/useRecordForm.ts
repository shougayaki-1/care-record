'use client';

import { readActionResult } from '@/utils/actionResult';

import { useAsyncRecordAction } from '@/hooks/useAsyncRecordAction';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import {
  uploadReportImage,
} from '@/app/actions/reports';
import { getLinkedShifts, getShiftSuggestions } from '@/app/actions/reportShifts';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { useWorkspace } from '@/context/WorkspaceContext';
import { supabase } from '@/lib/supabase';
import type { ExtractionResult } from '@/lib/ai/extractSchema';
import { checkRecordPermission } from '@/utils/permissions';

import type {
  ActualStaffInput, FormAnswers, FormItem, LinkedShift, ReportStatus,
  ShiftSegmentData, ShiftSuggestion, TravelExpense,
  RecordFormState as FormState, RecordUiState as UiState, RecordShiftState as ShiftState,
} from './recordForm/types';
import { useRecordAutosave, type RecordAutosaveValues } from './recordForm/useRecordAutosave';
import { useRecordImages } from './recordForm/useRecordImages';
import { useRecordInitialization } from './recordForm/useRecordInitialization';
import { useRecordActions } from './recordForm/useRecordActions';

export type {
  ActualStaffInput, FormAnswers, FormItem, HelperProfile, LinkedShift,
  ServiceTypeOption, ShiftSegmentData, ShiftSuggestion, StaffRoleOption, TravelExpense,
} from './recordForm/types';

type SetStateValue<T> = T | ((prev: T) => T);

type FormAction =
  | { type: 'PATCH'; patch: Partial<FormState> }
  | { type: 'SET_FIELD'; field: keyof FormState; value: SetStateValue<unknown> }
  | { type: 'SET_ANSWER'; id: string; value: FormAnswers[string] }
  | { type: 'SET_ANSWERS'; value: SetStateValue<FormAnswers> }
  | { type: 'RESET' }
  | { type: 'CLEAR_ANSWERS' }
  | { type: 'AI_FILL'; answers: FormAnswers; fields: Set<string> };

type UiAction =
  | { type: 'PATCH'; patch: Partial<UiState> }
  | { type: 'SET_FIELD'; field: keyof UiState; value: SetStateValue<unknown> }
  | { type: 'RESET'; currentReportId: string | null }
  | { type: 'MARK_DIRTY'; dirty?: boolean }
  | { type: 'SET_ERROR_MAP'; errors: Record<string, string> }
  | { type: 'CLEAR_ERROR'; id: string };

type ShiftAction =
  | { type: 'PATCH'; patch: Partial<ShiftState> }
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
  travelExpenses: {},
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
    case 'PATCH':
      return { ...state, ...action.patch };
    case 'SET_FIELD':
      return { ...state, [action.field]: resolveStateValue(action.value, state[action.field]) };
    case 'SET_ANSWER':
      return { ...state, answers: { ...state.answers, [action.id]: action.value } };
    case 'RESET':
      return formInitialState;
    case 'SET_ANSWERS':
      return { ...state, answers: resolveStateValue(action.value, state.answers) };
    case 'CLEAR_ANSWERS':
      return { ...state, answers: {}, travelExpenses: {} };
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
    case 'PATCH':
      return { ...state, ...action.patch };
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
    case 'PATCH':
      return { ...state, ...action.patch };
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
  const recordIdentityKey = `${userId ?? ''}:${currentOrg?.id ?? ''}:${clientId ?? ''}:${paramReportId ?? ''}:${shiftId ?? ''}:${segmentId ?? ''}`;
  const draftScope = useMemo(
    () => ({ identity: recordIdentityKey, key: incomingDraftKey || crypto.randomUUID() }),
    [incomingDraftKey, recordIdentityKey],
  );
  const draftKey = draftScope.key;
  const actions = useAsyncRecordAction(`${recordIdentityKey}:${draftKey}`);
  const { pending: actionPending, error: actionError, errorCause: actionErrorCause, run, isRunning } = actions;
  const recordScopeKey = `${recordIdentityKey}:${draftKey}`;
  const [linksFailure, setLinksFailure] = useState<{ scope: string; cause: unknown } | null>(null);
  const [linksReload, setLinksReload] = useState(0);
  const linkedLoadError = linksFailure?.scope === recordScopeKey ? linksFailure.cause : null;
  const retryLinkedShifts = () => { setLinksFailure(null); setLinksReload(value => value + 1); };

  const contentVersionRef = useRef(0);

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
    travelExpenses,
    aiFilledFields,
    isSpanningMonth,
    selectedPart,
    originalShiftTimes,
  } = formState;
  const { currentReportId, currentStatus, isDirty, openCloseDialog, loading: uiLoading, errors, submitting: imageSubmitting } = uiState;
  const submitting = imageSubmitting || actionPending;
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

  const setAnswers = useCallback((value: SetStateValue<FormAnswers>) => formDispatch({ type: 'SET_ANSWERS', value }), []);
  const setSelectedHelpers = useCallback((value: SetStateValue<string[]>) => setFormField('selectedHelpers', value), [setFormField]);
  const setActualStaffs = useCallback((value: SetStateValue<ActualStaffInput[]>) => setFormField('actualStaffs', value), [setFormField]);
  const setActualServiceTypeId = useCallback((value: SetStateValue<string>) => setFormField('actualServiceTypeId', value), [setFormField]);
  const setStartDateTime = useCallback((value: SetStateValue<string>) => setFormField('startDateTime', value), [setFormField]);
  const setEndDateTime = useCallback((value: SetStateValue<string>) => setFormField('endDateTime', value), [setFormField]);
  const setServiceTime = useCallback((value: SetStateValue<string>) => setFormField('serviceTime', value), [setFormField]);
  const setTravelTime = useCallback((value: SetStateValue<string>) => setFormField('travelTime', value), [setFormField]);
  const setTravelExpenses = useCallback((value: SetStateValue<Record<string, TravelExpense>>) => setFormField('travelExpenses', value), [setFormField]);
  const setAiFilledFields = useCallback((value: SetStateValue<Set<string>>) => setFormField('aiFilledFields', value), [setFormField]);
  const setHasAiDraftSource = useCallback((value: SetStateValue<boolean>) => setFormField('hasAiDraftSource', value), [setFormField]);
  const setIsSpanningMonth = useCallback((value: SetStateValue<boolean>) => setFormField('isSpanningMonth', value), [setFormField]);
  const setSelectedPart = useCallback((value: SetStateValue<'part1' | 'part2'>) => setFormField('selectedPart', value), [setFormField]);
  const setOriginalShiftTimes = useCallback((value: SetStateValue<{ start_at: string; end_at: string } | null>) => setFormField('originalShiftTimes', value), [setFormField]);

  const setCurrentReportId = useCallback((value: SetStateValue<string | null>) => setUiField('currentReportId', value), [setUiField]);
  const setCurrentStatus = useCallback((value: SetStateValue<ReportStatus | null>) => setUiField('currentStatus', value), [setUiField]);
  const setIsDirty = useCallback((value: SetStateValue<boolean>) => setUiField('isDirty', value), [setUiField]);
  const setOpenCloseDialog = useCallback((value: SetStateValue<boolean>) => setUiField('openCloseDialog', value), [setUiField]);
  const setErrors = useCallback((value: SetStateValue<Record<string, string>>) => {
    uiDispatch({ type: 'SET_ERROR_MAP', errors: resolveStateValue(value, errors) });
  }, [errors]);
  const externalPending = useRef(false);
  const setSubmitting = useCallback((value: boolean) => { externalPending.current = value; setUiField('submitting', value); }, [setUiField]);

  const setShiftSuggestions = useCallback((value: SetStateValue<ShiftSuggestion[]>) => setShiftField('shiftSuggestions', value), [setShiftField]);
  const setLinkedShifts = useCallback((value: SetStateValue<LinkedShift[]>) => setShiftField('linkedShifts', value), [setShiftField]);
  const setSelectedSegmentId = useCallback((value: SetStateValue<string | null>) => setShiftField('selectedSegmentId', value), [setShiftField]);

  const restoreAutosave = useCallback((payload: Partial<RecordAutosaveValues>) => {
    if (payload.answers) setAnswers(payload.answers);
    if (payload.selectedHelpers) setSelectedHelpers(payload.selectedHelpers);
    if (payload.actualStaffs) setActualStaffs(payload.actualStaffs);
    if (payload.actualServiceTypeId !== undefined) setActualServiceTypeId(payload.actualServiceTypeId);
    if (payload.startDateTime) setStartDateTime(payload.startDateTime);
    if (payload.endDateTime) setEndDateTime(payload.endDateTime);
    if (payload.serviceTime !== undefined) setServiceTime(payload.serviceTime);
    if (payload.travelTime !== undefined) setTravelTime(payload.travelTime);
    if (payload.travelExpenses) setTravelExpenses(payload.travelExpenses);
    setIsDirty(true);
  }, [setActualServiceTypeId, setActualStaffs, setAnswers, setEndDateTime, setIsDirty, setSelectedHelpers, setServiceTime, setStartDateTime, setTravelExpenses, setTravelTime]);

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

  const applyForm = useCallback((patch: Partial<FormState>) => formDispatch({ type: 'PATCH', patch }), []);
  const applyUi = useCallback((patch: Partial<UiState>) => uiDispatch({ type: 'PATCH', patch }), []);
  const applyShift = useCallback((patch: Partial<ShiftState>) => shiftDispatch({ type: 'PATCH', patch }), []);
  const reset = useCallback(() => {
    formDispatch({ type: 'RESET' });
    uiDispatch({ type: 'RESET', currentReportId: paramReportId });
    shiftDispatch({ type: 'RESET', selectedSegmentId: segmentId });
  }, [paramReportId, segmentId]);
  const { loading, readyLoad, loadError, retryLoad } = useRecordInitialization({
    recordScopeKey, currentOrg, wsLoading, userId, clientId, paramReportId, shiftId,
    segmentId, draftKey, uiLoading, contentVersionRef, applyForm, applyUi, applyShift,
    reset, formatDatetimeLocal, setupTimeForPart, applySegmentDefaults,
  });

  const { autosaveState, discardCommittedAutosave } = useRecordAutosave({
    scopeKey: recordScopeKey,
    organizationId: currentOrg?.id,
    clientId: clientId as string,
    reportId: currentReportId,
    draftKey,
    loading,
    isDirty,
    submitting,
    status: currentStatus,
    values: { answers, selectedHelpers, actualStaffs, actualServiceTypeId, startDateTime, endDateTime, serviceTime, travelTime, travelExpenses },
    restore: restoreAutosave,
  });
  const { images, imagesLoading, imagesError, retryImages } = useRecordImages({
    scopeKey: recordScopeKey,
    organizationId: currentOrg?.id,
    reportId: currentReportId,
    loading,
    generation: readyLoad?.generation,
  });

  const {
    handleDeleteReport, handleDraftSave, handleSubmit, handlePendingSave,
    handleApprove, handleRemand, handleClose, handleDialogDiscard, handleDialogSaveDraft,
  } = useRecordActions({
    currentOrg, clientId: clientId as string, shiftId, segmentId, draftKey, selectedSegmentId,
    shiftSegmentCount: shiftSegments.length, form: formState, ui: uiState, actions,
    externalPending, contentVersionRef, applyForm, applyUi, discardCommittedAutosave,
  });

  const handlePartChange = async (part: 'part1' | 'part2') => {
      if (isRunning() || externalPending.current) return;
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
      } else {
          setCurrentReportId(null);
          router.replace(`/app/record/${clientId}?shiftId=${shiftId}&draftKey=${encodeURIComponent(draftKey)}`);
          setupTimeForPart(part, originalShiftTimes.start_at, originalShiftTimes.end_at);
          setAnswers({});
          setTravelExpenses({});
          setCurrentStatus('draft');
      }
  };

  useEffect(() => {
    if (currentReportId || selectableStaffs.length === 0 || selectedHelpers.length === 0) return;
    setTravelExpenses((previous) => {
      const next = { ...previous };
      for (const staff of selectableStaffs.filter((helper) => selectedHelpers.includes(helper.name))) {
        if (!next[staff.id]) next[staff.id] = { method: 'car', amountYen: staff.defaultTravelCostYen == null ? '' : String(staff.defaultTravelCostYen) };
      }
      return next;
    });
  }, [currentReportId, selectableStaffs, selectedHelpers, setTravelExpenses]);

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
    if (loading || !currentReportId || !currentOrg) return;
    let cancelled = false;
    void Promise.all([
      readActionResult(getLinkedShifts(currentReportId)),
      readActionResult(getShiftSuggestions(currentOrg.id, currentReportId)),
    ]).then(([linked, suggestions]) => {
      if (cancelled) return;
      setLinksFailure(previous => previous?.scope === recordScopeKey ? null : previous);
      setLinkedShifts(linked as LinkedShift[]);
      setShiftSuggestions(suggestions);
    }).catch((error) => {
      if (!cancelled) {
        console.error('Failed to load linked shifts or suggestions', error);
        setLinksFailure({ scope: recordScopeKey, cause: error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loading, currentReportId, currentOrg, linksReload, recordScopeKey, setLinkedShifts, setShiftSuggestions]);

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
    if (!currentReportId || !e.target.files?.length || isRunning() || externalPending.current) return;
    const file = e.target.files[0];
    await run(async (isCurrent) => {
      if (!currentOrg) throw new Error('事業所が選択されていません');
      const formData = new FormData();
      formData.set('organizationId', currentOrg.id);
      formData.set('reportId', currentReportId);
      formData.set('file', file);
      await readActionResult(uploadReportImage(formData));
      if (isCurrent()) retryImages();
    }, { successMessage: '画像をアップロードしました', errorMessage: 'アップロード失敗' });
  }, [currentOrg, currentReportId, isRunning, retryImages, run]);

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
      setIsDirty(true);
      if (errors.helpers) {
          const newErrors = { ...errors };
          delete newErrors.helpers;
          setErrors(newErrors);
      }
  }, [actualStaffs, errors, selectableStaffs, setActualStaffs, setErrors, setIsDirty, setSelectedHelpers]);

  const dismissShiftSuggestion = useCallback((id: string) => {
    shiftDispatch({ type: 'DISMISS_SUGGESTION', id });
  }, []);


  return {
    router, showToast, currentOrg, clientId, shiftId, segmentId,
    autosaveState, clientName, template, answers, selectableStaffs, staffRoles, serviceTypes,
    selectedHelpers, actualStaffs, actualServiceTypeId, startDateTime, endDateTime,
    serviceTime, travelTime, travelExpenses, images, imagesLoading, imagesError, retryImages, loadError, retryLoad,
    aiFilledFields, isSpanningMonth, selectedPart, originalShiftTimes,
    currentReportId, currentStatus, isDirty, openCloseDialog, loading, errors, submitting, actionError, actionErrorCause,
    shiftSuggestions, linkedShifts, linkedLoadError, retryLinkedShifts, dismissedSuggestions, shiftSegments, selectedSegmentId,
    setShiftSuggestions, setLinkedShifts, setSelectedSegmentId, dismissShiftSuggestion,
    setActualServiceTypeId, setActualStaffs, setStartDateTime, setEndDateTime,
    setServiceTime, setTravelTime, setTravelExpenses,
    setIsDirty, setOpenCloseDialog,
    formatTimeForLabel, formatSegmentLabel, handlePartChange, handleChange, handleAnswerChange,
    handleImageUpload, handleDeleteReport, handleDraftSave, handleSubmit, handlePendingSave,
    handleApprove, handleRemand, handleClose, handleDialogDiscard, handleDialogSaveDraft,
    handleAiExtracted, handleAiProcessingChange: setSubmitting, groupedSections, isAdmin, isReadOnly, canDeleteRecord,
    requiresSegmentSelection, aiClients, aiHelpers, handleStaffChange,
  };
}
