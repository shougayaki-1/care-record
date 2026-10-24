import { useState } from 'react';
import { ActionResultError, getActionErrorMessage, readActionResult } from '@/utils/actionResult';
import { commitRecordChange } from '@/utils/recordFeedUpdates';
import { saveReport } from '@/app/actions/reports';
import type { ReviewRow } from '@/components/ui/AiImportReviewTable';
import { buildSavePayload, type Candidate } from './transforms';
import type { ImportAction } from './types';

type ReviewOptions = {
  organizationId: string | undefined;
  candidatesReady: boolean;
  clients: Candidate[];
  helpers: Candidate[];
  action: ImportAction;
  setOperationKind: (kind: 'extract' | 'save') => void;
};

export function useAiImportReview({ organizationId, candidatesReady, clients, helpers, action, setOperationKind }: ReviewOptions) {
  const { run, isRunning, attemptKey, finishAttempt } = action;
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const handleRowChange = (id: string, changes: Partial<ReviewRow>) => {
    if (isRunning()) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes, saveStatus: r.saveStatus === 'error' ? undefined : r.saveStatus, saveError: undefined } : r)));
  };

  const handleSaveSelected = async (ids: string[]) => {
    if (!organizationId || !candidatesReady || isRunning()) return;
    const selectedIds = [...new Set(ids)].filter((id) => rows.some((row) => row.id === id && row.status === 'confirmed' && row.saveStatus !== 'saved'));
    if (selectedIds.length === 0) return;
    setOperationKind('save');
    await run(async (isCurrent) => {
      // Mark all as saving
      setRows((prev) =>
        prev.map((r) => (selectedIds.includes(r.id) ? { ...r, saveStatus: 'saving', saveError: undefined } : r)),
      );

      try {
        const results = await commitRecordChange(organizationId, () => Promise.allSettled(
          selectedIds.map(async (id) => {
            const row = rows.find((r) => r.id === id);
            const payload = buildSavePayload(row, organizationId, clients, helpers);
            await readActionResult(saveReport({ ...payload, idempotencyKey: attemptKey(id, payload) }));
            finishAttempt(id);
            return id;
          }),
        ), (batch) => batch.some((result) => result.status === 'fulfilled'));

        if (isCurrent()) setRows((prev) =>
          prev.map((r) => {
            if (!selectedIds.includes(r.id)) return r;
            const result = results[selectedIds.indexOf(r.id)];
            if (result.status === 'fulfilled') return { ...r, saveStatus: 'saved', saveError: undefined };
            return { ...r, saveStatus: 'error', saveError: result.reason instanceof ActionResultError && result.reason.code !== 'UNEXPECTED_ERROR' ? getActionErrorMessage(result.reason) : '保存に失敗しました。入力内容を確認して再試行してください。' };
          }),
        );

        return { saved: results.filter((result) => result.status === 'fulfilled').length, failed: results.filter((result) => result.status === 'rejected').length };
      } catch (error) {
        if (isCurrent()) setRows((previous) => previous.map((row) => selectedIds.includes(row.id) && row.saveStatus === 'saving' ? { ...row, saveStatus: 'error', saveError: '保存に失敗しました。入力内容を確認して再試行してください。' } : row));
        throw error;
      }
    }, {
      successMessage: ({ saved, failed }) => failed ? `${saved} 件を保存、${failed} 件の保存に失敗しました。失敗した記録は再試行できます。` : `${saved} 件を下書き保存しました`,
      successSeverity: ({ saved, failed }) => failed ? (saved ? 'warning' : 'error') : 'success',
      errorMessage: '保存に失敗しました。入力内容は保持しています。もう一度下書き保存してください。',
    });
  };

  return { rows, setRows, handleRowChange, handleSaveSelected };
}
