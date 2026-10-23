'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getBackupRecords, getLastBackupRun, listDailyBackups, triggerDailyBackup,
  type BackupRecord,
} from '@/app/actions/backup';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';
import { useRequestGeneration } from '@/hooks/useRequestGeneration';

type RequestState<T> = {
  scope: string;
  status: 'loading' | 'success' | 'error';
  data: T | null;
  error: string | null;
};

// Separate lanes for files, record bodies and run metadata. The scope check also
// hides former-scope state during render, before effect cleanup has run.
function useBackupRequest<T>(scope: string, enabled: boolean, fetcher: () => Promise<T>, message: string) {
  const [state, setState] = useState<RequestState<T>>({ scope, status: 'loading', data: null, error: null });
  if (state.scope !== scope) {
    setState({ scope, status: 'loading', data: null, error: null });
  }
  const fetcherRef = useRef(fetcher);
  const { next, invalidate, isCurrent } = useRequestGeneration();
  useEffect(() => { fetcherRef.current = fetcher; }, [fetcher]);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const generation = next();
    setState({ scope, status: 'loading', data: null, error: null });
    try {
      const data = await fetcherRef.current();
      if (isCurrent(generation)) setState({ scope, status: 'success', data, error: null });
    } catch (error) {
      if (isCurrent(generation)) {
        setState({ scope, status: 'error', data: null, error: getActionErrorMessage(error, message) });
      }
    }
  }, [enabled, scope, next, isCurrent, message]);

  useEffect(() => {
    invalidate();
    const timer = enabled ? window.setTimeout(() => void refetch(), 0) : undefined;
    return () => {
      window.clearTimeout(timer);
      invalidate();
    };
  }, [enabled, scope, refetch, invalidate]);

  const current = enabled && state?.scope === scope ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: enabled && (!current || current.status === 'loading'),
    loaded: current?.status === 'success',
    refetch,
  };
}

export function useBackupData(organizationId: string) {
  const filesRequest = useBackupRequest(organizationId, !!organizationId,
    () => readActionResult(listDailyBackups(organizationId)), 'バックアップファイルの取得に失敗しました');
  const lastRunRequest = useBackupRequest(organizationId, !!organizationId,
    async () => {
      const run = await readActionResult(getLastBackupRun(organizationId));
      return { run, stale: !!run && Date.now() - new Date(run.createdAt).getTime() > 30 * 60 * 60 * 1000 };
    }, '最終自動バックアップ実行情報の取得に失敗しました');
  const files = filesRequest.data?.configured ? filesRequest.data.files : [];
  const [selection, setSelection] = useState<{ organizationId: string; date: string; path: string } | null>(null);
  const ownSelection = selection?.organizationId === organizationId ? selection : null;
  const selectedDate = files.length ? ownSelection?.date ?? files[0].date : '';
  const dateFiles = files.filter((file) => file.date === selectedDate);
  const selectedBackupPath = dateFiles.find((file) => file.path === ownSelection?.path)?.path ?? dateFiles[0]?.path ?? '';
  const recordScope = JSON.stringify([organizationId, selectedBackupPath]);
  const recordsRequest = useBackupRequest(recordScope, !!organizationId && !!selectedBackupPath,
    () => readActionResult(getBackupRecords(organizationId, selectedBackupPath)), '記録の取得に失敗しました');
  const records = recordsRequest.data;
  const [detail, setDetail] = useState<{ record: BackupRecord; snapshot: BackupRecord[] } | null>(null);
  if (detail && detail.snapshot !== records) setDetail(null);
  const selectedRecord = detail?.snapshot === records ? detail.record : null;
  const [triggerState, setTriggerState] = useState({ organizationId, loading: false });
  if (triggerState.organizationId !== organizationId) setTriggerState({ organizationId, loading: false });
  const { next, invalidate, isCurrent } = useRequestGeneration();
  useEffect(() => invalidate, [organizationId, invalidate]);

  async function triggerBackup(notify: (message: string, severity: 'success' | 'error') => void) {
    if (!organizationId) return;
    const generation = next();
    setTriggerState({ organizationId, loading: true });
    try {
      const { date, records } = await readActionResult(triggerDailyBackup(organizationId));
      if (!isCurrent(generation)) return;
      notify(`バックアップ完了（${date}：${records} 件）`, 'success');
      // Keep the user's latest selection; the returned list alone determines
      // the fallback when that selection no longer exists.
      await filesRequest.refetch();
    } catch (error) {
      if (isCurrent(generation)) notify(getActionErrorMessage(error, 'バックアップに失敗しました'), 'error');
    } finally {
      if (isCurrent(generation)) setTriggerState({ organizationId, loading: false });
    }
  }

  return {
    files, dateFiles, selectedDate, selectedBackupPath,
    selectDate: (date: string) => setSelection({ organizationId, date, path: '' }),
    selectBackup: (path: string) => setSelection({ organizationId, date: selectedDate, path }),
    records: records ?? [], selectedRecord,
    selectRecord: (record: BackupRecord | null) => setDetail(record && records ? { record, snapshot: records } : null),
    loadingFiles: filesRequest.loading, loadingRecords: recordsRequest.loading,
    filesError: filesRequest.error, recordsError: recordsRequest.error,
    retryFiles: filesRequest.refetch, retryRecords: recordsRequest.refetch,
    gcsNotConfigured: filesRequest.data?.configured === false,
    lastRun: lastRunRequest.data?.run ?? null, lastRunStale: lastRunRequest.data?.stale ?? false, lastRunLoaded: lastRunRequest.loaded,
    lastRunLoading: lastRunRequest.loading, lastRunError: lastRunRequest.error,
    retryLastRun: lastRunRequest.refetch,
    triggering: triggerState.organizationId === organizationId && triggerState.loading, triggerBackup,
  };
}
