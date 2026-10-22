'use client';

import { useCallback, useMemo, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { saveReport as saveReportAction, softDeleteReports, transitionReports } from '@/app/actions/reports';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { useToast } from '@/components/ui/ToastProvider';
import type { Workspace } from '@/context/WorkspaceContext';
import type { useAsyncRecordAction } from '@/hooks/useAsyncRecordAction';
import { ActionResultError, readActionResult } from '@/utils/actionResult';
import { commitRecordChange } from '@/utils/recordFeedUpdates';
import type { RecordFormState, RecordUiState, ReportStatus, TravelExpense } from './types';

type RecordActionsOptions = {
  currentOrg: Workspace | null;
  clientId: string;
  shiftId: string | null;
  segmentId: string | null;
  draftKey: string;
  selectedSegmentId: string | null;
  shiftSegmentCount: number;
  form: RecordFormState;
  ui: RecordUiState;
  actions: ReturnType<typeof useAsyncRecordAction>;
  externalPending: RefObject<boolean>;
  contentVersionRef: RefObject<number>;
  applyForm: (patch: Partial<RecordFormState>) => void;
  applyUi: (patch: Partial<RecordUiState>) => void;
  discardCommittedAutosave: () => void;
};

/** Share the existing operation lock across all writes and navigate only after success. */
export function useRecordActions({
  currentOrg, clientId, shiftId, segmentId, draftKey, selectedSegmentId, shiftSegmentCount,
  form, ui, actions, externalPending, contentVersionRef, applyForm, applyUi, discardCommittedAutosave,
}: RecordActionsOptions) {
  const router = useRouter();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { run, isRunning, attemptKey, finishAttempt } = actions;
  const { currentReportId, currentStatus, isDirty, submitting: imageSubmitting } = ui;
  const {
    answers, selectedHelpers, actualStaffs, actualServiceTypeId, startDateTime, endDateTime,
    serviceTime, travelTime, travelExpenses, hasAiDraftSource, selectableStaffs, template,
  } = form;

  const handleDeleteReport = useCallback(async () => {
    if (externalPending.current) return;
    if (currentStatus === 'approved') { showToast('承認済みの記録は削除できません', 'error'); return; }
    const outcome = await run(async () => {
      if (!currentReportId || !currentOrg) throw new Error('削除対象が不正です');
      await commitRecordChange(currentOrg.id, () => readActionResult(softDeleteReports(currentOrg.id, [currentReportId], '記録編集画面から削除')));
    }, {
      confirm: () => confirm({ title: '記録の削除', message: '本当に削除しますか？', confirmText: '削除する', confirmColor: 'error' }),
      successMessage: '削除しました', errorMessage: '削除に失敗しました。もう一度操作してください。',
    });
    if (outcome.ok) router.back();
  }, [confirm, currentOrg, currentReportId, currentStatus, router, run, showToast, externalPending]);

  const getTravelExpense = useCallback((staffId: string): TravelExpense => {
    const configured = travelExpenses[staffId];
    if (configured) return configured;
    if (currentReportId) return { method: 'car', amountYen: '' };
    const defaultYen = selectableStaffs.find((staff) => staff.id === staffId)?.defaultTravelCostYen;
    return { method: 'car', amountYen: defaultYen == null ? '' : String(defaultYen) };
  }, [currentReportId, selectableStaffs, travelExpenses]);

  const travelExpenseRows = useMemo(() => actualStaffs.map((staff) => {
    const expense = getTravelExpense(staff.staff_id);
    return {
      staff_id: staff.staff_id,
      staff_name: selectableStaffs.find((candidate) => candidate.id === staff.staff_id)?.name ?? '',
      method: expense.method,
      amount_yen: expense.amountYen === '' ? null : Number(expense.amountYen),
    };
  }), [actualStaffs, getTravelExpense, selectableStaffs]);

  const validate = useCallback(() => {
    const ne: Record<string, string> = {};
    if (!serviceTime) ne['serviceTime'] = '必須項目です';
    if (selectedHelpers.length === 0) ne['helpers'] = '担当スタッフを選択してください';
    if (actualStaffs.length !== selectedHelpers.length) ne['helpers'] = '担当スタッフをスタッフ名簿から選択してください';
    for (const expense of travelExpenseRows) {
      if (expense.amount_yen === null || !Number.isInteger(expense.amount_yen) || expense.amount_yen < 0 || expense.amount_yen > 100000) {
        ne[`travel_${expense.staff_id}`] = '交通費を0〜100000円で入力してください';
      }
    }
    template.forEach(item => {
      const val = answers[item.id];
      if (item.required && (!val || (Array.isArray(val) && val.length === 0))) ne[item.id] = '必須項目です';
    });
    applyUi({ errors: ne });
    return Object.keys(ne).length === 0;
  }, [actualStaffs.length, answers, selectedHelpers.length, serviceTime, applyUi, template, travelExpenseRows]);

  const saveReport = useCallback(async (status: ReportStatus, skipValidation: boolean, feedback: { message: string; confirm?: () => Promise<boolean> }) => {
    if (externalPending.current) return false;
    let savedUrl: string | null = null;
    const outcome = await run(async (isCurrent) => {
      if (shiftId && shiftSegmentCount > 0 && !selectedSegmentId) {
        showToast('記録を作成する前にサービス区間を選択してください', 'warning');
        return false;
      }
      if (!skipValidation && !validate()) { showToast('入力不備があります', 'error'); window.scrollTo({ top: 0, behavior: 'smooth' }); return false; }
      const finalData = {
        ...answers,
        _helpers: selectedHelpers,
        service_time: serviceTime,
        travel_time: travelTime,
        travel_expenses: travelExpenseRows,
        travel_cost_yen: travelExpenseRows.reduce((sum, expense) => sum + (expense.amount_yen ?? 0), 0),
      };
      if (!currentOrg) throw new Error('事業所が選択されていません');
      const payload = {
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
        ...(status === 'draft' && hasAiDraftSource
          ? { auditSource: 'ai_import' as const, auditFileCount: 1 }
          : {}),
      } satisfies Omit<Parameters<typeof saveReportAction>[0], 'idempotencyKey'>;
      const result = await commitRecordChange(currentOrg.id, () => readActionResult(saveReportAction({ ...payload, idempotencyKey: attemptKey('report', payload) })));
      finishAttempt('report');
      if (!isCurrent()) return false;
      const targetReportId = result.reportId;
      contentVersionRef.current = result.version;
      applyForm({ travelExpenses: Object.fromEntries(travelExpenseRows.map((expense) => [expense.staff_id, { method: expense.method, amountYen: expense.amount_yen == null ? '' : String(expense.amount_yen) }])) });
      if (!currentReportId) applyUi({ currentReportId: targetReportId });
      if (status === 'draft') applyForm({ hasAiDraftSource: false });
      applyUi({ isDirty: false });
      discardCommittedAutosave();

      if (!currentReportId && targetReportId) {
          const newUrl = `/app/record/${clientId}?reportId=${targetReportId}&draftKey=${encodeURIComponent(draftKey)}`;
          savedUrl = newUrl;
      }

      return true;
    }, {
      confirm: feedback.confirm,
      successMessage: (saved) => saved ? feedback.message : null,
      errorMessage: (error) => error instanceof ActionResultError && error.code === 'VERSION_CONFLICT'
        ? '他の利用者がこの記録を更新しました。入力内容は保持しています。再読み込みして差分を確認してください。'
        : '保存に失敗しました。入力内容は保持しています。もう一度操作してください。',
    });
    if (outcome.ok && outcome.value && savedUrl) router.replace(savedUrl);
    return outcome.ok && outcome.value;
  }, [actualServiceTypeId, actualStaffs, answers, clientId, currentOrg, currentReportId, draftKey, discardCommittedAutosave, endDateTime, hasAiDraftSource, attemptKey, finishAttempt, router, run, segmentId, selectedHelpers, selectedSegmentId, serviceTime, applyUi, applyForm, shiftId, shiftSegmentCount, showToast, startDateTime, travelExpenseRows, travelTime, validate, externalPending, contentVersionRef]);

  const handleDraftSave = useCallback(() => saveReport('draft', true, { message: '下書きを保存しました' }), [saveReport]);
  const handleSubmit = useCallback(async () => {
    if (await saveReport('pending', false, {
      message: '記録を送信しました',
      confirm: () => confirm({ title: '送信の確認', message: '記録を送信しますか？', confirmText: '送信する' }),
    })) router.push('/app/record');
  }, [confirm, router, saveReport]);
  const handlePendingSave = useCallback(() => saveReport('pending', false, { message: '承認待ちのまま変更を保存しました' }), [saveReport]);
  const handleApprove = useCallback(async () => {
    if (externalPending.current) return;
    if (!currentOrg || !currentReportId) return;
    const outcome = await run(() => commitRecordChange(currentOrg.id, () => readActionResult(transitionReports(currentOrg.id, [currentReportId], 'approve'))), {
      confirm: () => confirm({ title: '承認の確認', message: 'この記録を承認しますか？', confirmText: '承認する', confirmColor: 'primary' }),
      successMessage: '承認しました', errorMessage: '承認に失敗しました。もう一度操作してください。',
    });
    if (outcome.ok) router.push('/app/reports');
  }, [confirm, currentOrg, currentReportId, router, run, externalPending]);
  const handleRemand = useCallback(async () => {
    if (externalPending.current) return;
    if (!currentOrg || !currentReportId) return;
    const outcome = await run(() => commitRecordChange(currentOrg.id, () => readActionResult(transitionReports(currentOrg.id, [currentReportId], 'remand'))), {
      confirm: () => confirm({ title: '承認取消の確認', message: '承認を取り消し、差し戻しますか？', confirmText: '差し戻す', confirmColor: 'warning' }),
      successMessage: '記録を差し戻しました', successSeverity: 'info', errorMessage: '差し戻しに失敗しました。もう一度操作してください。',
    });
    if (outcome.ok) router.push('/app/reports');
  }, [confirm, currentOrg, currentReportId, router, run, externalPending]);

  const handleClose = useCallback(() => { if (isRunning() || externalPending.current || imageSubmitting) return; if (isDirty) applyUi({ openCloseDialog: true }); else router.back(); }, [imageSubmitting, isDirty, isRunning, router, applyUi, externalPending]);
  const handleDialogDiscard = useCallback(() => { if (isRunning()) return; applyUi({ openCloseDialog: false }); router.back(); }, [isRunning, router, applyUi]);
  const handleDialogSaveDraft = useCallback(async () => {
    if (await saveReport('draft', true, { message: '下書きを保存しました' })) {
      applyUi({ openCloseDialog: false });
      router.back();
    }
  }, [router, saveReport, applyUi]);

  return {
    handleDeleteReport, handleDraftSave, handleSubmit, handlePendingSave,
    handleApprove, handleRemand, handleClose, handleDialogDiscard, handleDialogSaveDraft,
  };
}
