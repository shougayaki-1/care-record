'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { supabase } from '@/lib/supabase';
import { useRequestGeneration } from '@/hooks/useRequestGeneration';
import { measureRecordLoad } from '@/utils/recordLoadTiming';
import { loadExistingRecord, loadRecordBaseData } from './loadRecordData';
import type { RecordFormState, RecordUiState, RecordShiftState, ShiftSegmentData, ShiftStaffData } from './types';

type RecordInitializationOptions = {
  recordScopeKey: string;
  currentOrg: Workspace | null;
  wsLoading: boolean;
  userId: string | null;
  clientId: string | string[] | undefined;
  paramReportId: string | null;
  shiftId: string | null;
  segmentId: string | null;
  draftKey: string;
  uiLoading: boolean;
  contentVersionRef: RefObject<number>;
  applyForm: (patch: Partial<RecordFormState>) => void;
  applyUi: (patch: Partial<RecordUiState>) => void;
  applyShift: (patch: Partial<RecordShiftState>) => void;
  reset: () => void;
  formatDatetimeLocal: (date: Date) => string;
  setupTimeForPart: (part: 'part1' | 'part2', startIso: string, endIso: string) => void;
  applySegmentDefaults: (segment: ShiftSegmentData) => void;
};

/** Own the initialization lane; publish only responses belonging to its current generation. */
export function useRecordInitialization({
  recordScopeKey, currentOrg, wsLoading, userId, clientId, paramReportId, shiftId,
  segmentId, draftKey, uiLoading, contentVersionRef, applyForm, applyUi, applyShift,
  reset, formatDatetimeLocal, setupTimeForPart, applySegmentDefaults,
}: RecordInitializationOptions) {
  const router = useRouter();
  const { showToast } = useToast();
  const [loadFailure, setLoadFailure] = useState<{ scope: string; attempt: number; cause: unknown } | null>(null);
  const [loadReload, setLoadReload] = useState(0);
  const [readyLoad, setReadyLoad] = useState<{ scope: string; generation: number } | null>(null);
  const { next: nextLoadGeneration, invalidate: invalidateLoadGeneration, isCurrent: isCurrentLoadGeneration } = useRequestGeneration();
  const retryLoad = useCallback(() => setLoadReload(value => value + 1), []);

  const fetchBaseData = useCallback(async (isCurrent: () => boolean, hasExistingReport: boolean) => {
    if (!currentOrg || typeof clientId !== 'string') return;
    const data = await loadRecordBaseData(currentOrg.id, clientId);
    if (!isCurrent()) return;
    applyForm(data);
    if (!hasExistingReport && !shiftId && userId) {
      const staff = data.selectableStaffs.find(candidate => candidate.user_id === userId);
      if (staff) applyForm({ selectedHelpers: [staff.name], actualStaffs: [{ staff_id: staff.id, staff_role_id: null }] });
    }
  }, [currentOrg, clientId, applyForm, shiftId, userId]);

  const loadExistingData = useCallback(async (reportId: string, isCurrent: () => boolean) => {
    if (!reportId || !currentOrg) return;
    const data = await loadExistingRecord({ organizationId: currentOrg.id, clientId: clientId as string, reportId, isCurrent, formatDatetimeLocal });
    if (!data || !isCurrent()) return;
    applyForm(data.form);
    applyUi({ currentStatus: data.status, isDirty: false });
    applyShift({ selectedSegmentId: data.segmentId });
    contentVersionRef.current = data.version;
  }, [currentOrg, clientId, formatDatetimeLocal, applyForm, applyUi, applyShift, contentVersionRef]);

  useEffect(() => {
    contentVersionRef.current = 0;
  }, [recordScopeKey, contentVersionRef]);

  useEffect(() => {
    const generation = nextLoadGeneration();
    const isCurrent = () => isCurrentLoadGeneration(generation);
    const init = async () => {
      let targetId = paramReportId;
      applyShift({ selectedSegmentId: segmentId });

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
          applyShift({ shiftSegments: typedSegments });

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
                  applyUi({ currentReportId: targetId });
                  router.replace(`/app/record/${clientId}?reportId=${targetId}&shiftId=${shiftId}&segmentId=${effectiveSegmentId}&draftKey=${encodeURIComponent(draftKey)}`);
                  showToast('この区間にはすでに記録が存在します。該当する記録を開きました。', 'info');
              } else {
                  const targetSegment = typedSegments.find((segment) => segment.id === effectiveSegmentId);
                  if (targetSegment) applySegmentDefaults(targetSegment);
              }
          } else if (typedSegments.length > 1) {
              applyUi({ currentStatus: 'draft' });
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
                  applyUi({ currentReportId: targetId });
                  router.replace(`/app/record/${clientId}?reportId=${targetId}&shiftId=${shiftId}&draftKey=${encodeURIComponent(draftKey)}`);
                  showToast('このシフトにはすでに記録が存在します。該当する記録を開きました。', 'info');
              } else if (shiftData) {
                  const s = new Date(shiftData.start_at);
                  const e = new Date(shiftData.end_at);
                  const isCrossMonth = s.getMonth() !== e.getMonth();

                  applyForm({ isSpanningMonth: isCrossMonth });
                  applyForm({ originalShiftTimes: { start_at: shiftData.start_at, end_at: shiftData.end_at } });

                  if (isCrossMonth) {
                      setupTimeForPart('part1', shiftData.start_at, shiftData.end_at);
                  } else {
                      applyForm({ startDateTime: formatDatetimeLocal(s) });
                      applyForm({ endDateTime: formatDatetimeLocal(e) });
                      const diffHours = (e.getTime() - s.getTime()) / (1000 * 60 * 60);
                      applyForm({ serviceTime: diffHours.toString() });
                  }

                  const staffNames: string[] = [];
                  const typedShiftStaffs = (shiftData.shift_staffs as unknown as ShiftStaffData[]) || [];

                  typedShiftStaffs.forEach(s => {
                      const name = Array.isArray(s.staffs) ? s.staffs[0]?.name : s.staffs?.name;
                      if (name) staffNames.push(name);
                  });

                  applyForm({ selectedHelpers: staffNames });
                  applyForm({ actualStaffs: typedShiftStaffs.map((staff) => ({ staff_id: staff.staff_id, staff_role_id: null })) });
                  applyUi({ currentStatus: 'draft' });
              }
          }
      }

      if (!targetId && !shiftId) {
        const now = new Date();
        applyForm({ startDateTime: formatDatetimeLocal(now) });
        applyForm({ endDateTime: formatDatetimeLocal(new Date(now.getTime() + 3600000)) });
        applyUi({ currentStatus: 'draft' });
      }

      await Promise.all([
        measureRecordLoad('base', () => fetchBaseData(isCurrent, Boolean(targetId))),
        targetId ? loadExistingData(targetId, isCurrent) : Promise.resolve(),
      ]);
      if (!isCurrent()) return;
      setReadyLoad({ scope: recordScopeKey, generation });
      applyUi({ loading: false });
    };

    reset();
    if (!wsLoading && currentOrg) {
      void measureRecordLoad('ready', init).catch((cause: unknown) => {
        if (isCurrent()) setLoadFailure({ scope: recordScopeKey, attempt: loadReload, cause });
      });
    }
    return () => {
      if (isCurrent()) invalidateLoadGeneration();
    };
  }, [recordScopeKey, loadReload, wsLoading, currentOrg, paramReportId, shiftId, segmentId, clientId, draftKey, router, showToast, fetchBaseData, loadExistingData, formatDatetimeLocal, setupTimeForPart, applySegmentDefaults, invalidateLoadGeneration, isCurrentLoadGeneration, nextLoadGeneration, applyForm, applyUi, applyShift, reset]);

  return {
    loading: uiLoading || readyLoad?.scope !== recordScopeKey,
    readyLoad,
    loadError: loadFailure?.scope === recordScopeKey && loadFailure.attempt === loadReload ? loadFailure.cause : null,
    retryLoad,
  };
}
