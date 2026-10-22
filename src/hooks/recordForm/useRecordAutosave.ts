'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { discardReportAutosave, loadReportAutosave, saveReportAutosave } from '@/app/actions/reports';
import { useToast } from '@/components/ui/ToastProvider';
import { readActionResult } from '@/utils/actionResult';
import type { ActualStaffInput, FormAnswers, ReportStatus, TravelExpense } from './types';

export type RecordAutosaveValues = {
  answers: FormAnswers;
  selectedHelpers: string[];
  actualStaffs: ActualStaffInput[];
  actualServiceTypeId: string;
  startDateTime: string;
  endDateTime: string;
  serviceTime: string;
  travelTime: string;
  travelExpenses: Record<string, TravelExpense>;
};

type RecordAutosaveOptions = {
  scopeKey: string;
  organizationId: string | undefined;
  clientId: string;
  reportId: string | null;
  draftKey: string;
  loading: boolean;
  isDirty: boolean;
  submitting: boolean;
  status: ReportStatus | null;
  values: RecordAutosaveValues;
  restore: (payload: Partial<RecordAutosaveValues>) => void;
};

/** Private server drafts only; care information must not be persisted in localStorage. */
export function useRecordAutosave({
  scopeKey, organizationId, clientId, reportId, draftKey,
  loading, isDirty, submitting, status, values, restore,
}: RecordAutosaveOptions) {
  const { showToast } = useToast();
  const restoredRef = useRef(false);
  const revisionRef = useRef(0);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const {
    answers, selectedHelpers, actualStaffs, actualServiceTypeId,
    startDateTime, endDateTime, serviceTime, travelTime, travelExpenses,
  } = values;

  useEffect(() => {
    restoredRef.current = false;
    revisionRef.current = 0;
  }, [scopeKey]);

  useEffect(() => {
    if (loading || !organizationId || restoredRef.current || status === 'approved') return;
    let cancelled = false;
    restoredRef.current = true;
    void readActionResult(loadReportAutosave(organizationId, draftKey)).then(saved => {
      if (cancelled || !saved?.payload) return;
      restore(saved.payload as Partial<RecordAutosaveValues>);
      revisionRef.current = saved.autosave_revision ?? 0;
      setAutosaveState('saved');
      showToast('入力途中の内容を復元しました', 'info');
    }).catch(error => {
      if (!cancelled) console.error('Failed to restore report autosave', error);
    });
    return () => { cancelled = true; };
  }, [organizationId, status, draftKey, loading, scopeKey, restore, showToast]);

  useEffect(() => {
    if (!isDirty || loading || submitting || !organizationId || status === 'approved') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const revision = revisionRef.current + 1;
      setAutosaveState('saving');
      void readActionResult(saveReportAutosave({
        organizationId, clientId, reportId, draftKey, autosaveRevision: revision,
        payload: {
          answers, selectedHelpers, actualStaffs, actualServiceTypeId,
          startDateTime, endDateTime, serviceTime, travelTime, travelExpenses,
        },
      })).then(result => {
        if (cancelled) return;
        if (result.saved) revisionRef.current = revision;
        setAutosaveState('saved');
      }).catch(error => {
        if (cancelled) return;
        console.error('Report autosave failed', error);
        setAutosaveState('error');
      });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actualServiceTypeId, actualStaffs, answers, clientId, organizationId, reportId, status, draftKey, endDateTime, isDirty, loading, scopeKey, selectedHelpers, serviceTime, submitting, startDateTime, travelExpenses, travelTime]);

  const discardCommittedAutosave = useCallback(() => {
    if (!organizationId) return;
    void readActionResult(discardReportAutosave(organizationId, draftKey)).catch(error => {
      console.error('Failed to discard committed autosave', error);
    });
    setAutosaveState('idle');
  }, [organizationId, draftKey]);

  return { autosaveState, discardCommittedAutosave };
}
