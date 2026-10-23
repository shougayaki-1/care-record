// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBackupRecords, getLastBackupRun, listDailyBackups, triggerDailyBackup, type BackupRecord, type BackupFileEntry } from '@/app/actions/backup';
import { useBackupData } from './useBackupData';

vi.mock('@/app/actions/backup', () => ({
  getBackupRecords: vi.fn(), getLastBackupRun: vi.fn(), listDailyBackups: vi.fn(), triggerDailyBackup: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const ok = <T,>(data: T) => ({ ok: true as const, data });
const failure = { ok: false as const, error: { code: 'UNEXPECTED_ERROR' as const, message: '取得できませんでした' } };
const file = (path: string): BackupFileEntry => ({ path, date: '2026-10-23', label: path, updated: '', size: 1 });
const record = (id: string): BackupRecord => ({ id, clientName: id, helperName: '', startAt: '', endAt: '', status: 'draft', values: { 内容: id }, createdAt: '', updatedAt: '' });
const files = [file('A'), file('B')];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listDailyBackups).mockResolvedValue(ok({ configured: true, files }));
  vi.mocked(getLastBackupRun).mockResolvedValue(ok(null));
  vi.mocked(getBackupRecords).mockResolvedValue(ok([record('A')]));
});
afterEach(cleanup);

async function mount() {
  const hook = renderHook(({ org }) => useBackupData(org), { initialProps: { org: 'org-a' } });
  await waitFor(() => expect(getBackupRecords).toHaveBeenCalledWith('org-a', 'A'));
  return hook;
}

describe('backup request scopes', () => {
  it('keeps only B after B then A resolve in reverse order', async () => {
    const a = deferred<Awaited<ReturnType<typeof getBackupRecords>>>();
    const b = deferred<Awaited<ReturnType<typeof getBackupRecords>>>();
    vi.mocked(getBackupRecords).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result } = await mount();
    act(() => result.current.selectBackup('B'));
    expect(result.current.records).toEqual([]);
    await waitFor(() => expect(getBackupRecords).toHaveBeenCalledWith('org-a', 'B'));
    await act(async () => { b.resolve(ok([record('B')])); });
    expect(result.current.records[0].id).toBe('B');
    await act(async () => { a.resolve(ok([record('A')])); });
    expect(result.current.selectedBackupPath).toBe('B');
    expect(result.current.records[0].id).toBe('B');
  });

  it.each(['resolve', 'reject'] as const)('ignores an old %s while B is loading and preserves B errors', async (settle) => {
    const a = deferred<Awaited<ReturnType<typeof getBackupRecords>>>();
    const b = deferred<Awaited<ReturnType<typeof getBackupRecords>>>();
    vi.mocked(getBackupRecords).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result } = await mount();
    act(() => result.current.selectBackup('B'));
    await waitFor(() => expect(getBackupRecords).toHaveBeenCalledTimes(2));
    await act(async () => { if (settle === 'resolve') a.resolve(failure); else a.reject(new Error('private detail')); });
    expect(result.current.loadingRecords).toBe(true);
    expect(result.current.recordsError).toBeNull();
    await act(async () => { b.resolve(failure); });
    expect(result.current.loadingRecords).toBe(false);
    expect(result.current.recordsError).toBe('取得できませんでした');
    vi.mocked(getBackupRecords).mockResolvedValue(ok([]));
    await act(() => result.current.retryRecords());
    expect(result.current.recordsError).toBeNull();
    expect(result.current.records).toEqual([]);
  });

  it('hides the former body and detail immediately on selection change, including a date without files', async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.records).toHaveLength(1));
    act(() => result.current.selectRecord(result.current.records[0]));
    expect(result.current.selectedRecord?.id).toBe('A');
    act(() => result.current.selectBackup('B'));
    expect(result.current.selectedRecord).toBeNull();
    expect(result.current.records).toEqual([]);
    act(() => result.current.selectDate('2026-10-22'));
    expect(result.current.selectedBackupPath).toBe('');
    expect(result.current.selectedRecord).toBeNull();
    expect(result.current.records).toEqual([]);
  });

  it.each(['empty', 'unconfigured', 'error'] as const)('clears paths, bodies and detail after a %s list and supports retry', async (kind) => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.records).toHaveLength(1));
    act(() => result.current.selectRecord(result.current.records[0]));
    vi.mocked(listDailyBackups).mockResolvedValueOnce(kind === 'error' ? failure : ok(kind === 'unconfigured' ? { configured: false } : { configured: true, files: [] }));
    await act(() => result.current.retryFiles());
    expect(result.current.files).toEqual([]);
    expect(result.current.selectedBackupPath).toBe('');
    expect(result.current.selectedDate).toBe('');
    expect(result.current.records).toEqual([]);
    expect(result.current.selectedRecord).toBeNull();
    expect(result.current.gcsNotConfigured).toBe(kind === 'unconfigured');
    expect(!!result.current.filesError).toBe(kind === 'error');
    await act(() => result.current.retryFiles());
    await waitFor(() => expect(result.current.records).toHaveLength(1));
    expect(result.current.filesError).toBeNull();
    expect(result.current.gcsNotConfigured).toBe(false);
    expect(result.current.selectedRecord).toBeNull();
  });

  it('discards former-organization file, body and metadata responses', async () => {
    const oldFiles = deferred<Awaited<ReturnType<typeof listDailyBackups>>>();
    const oldRun = deferred<Awaited<ReturnType<typeof getLastBackupRun>>>();
    const oldRecords = deferred<Awaited<ReturnType<typeof getBackupRecords>>>();
    vi.mocked(getLastBackupRun).mockReturnValueOnce(oldRun.promise);
    vi.mocked(getBackupRecords).mockReturnValueOnce(oldRecords.promise).mockResolvedValue(ok([record('new-org')]));
    const { result, rerender } = await mount();
    vi.mocked(listDailyBackups).mockReturnValueOnce(oldFiles.promise);
    act(() => { void result.current.retryFiles(); });
    rerender({ org: 'org-b' });
    expect(result.current.records).toEqual([]);
    expect(result.current.lastRunLoaded).toBe(false);
    await waitFor(() => expect(result.current.records[0]?.id).toBe('new-org'));
    await act(async () => { oldFiles.resolve(failure); oldRun.resolve(failure); oldRecords.resolve(ok([record('old-org')])); });
    expect(result.current.filesError).toBeNull();
    expect(result.current.lastRunError).toBeNull();
    expect(result.current.records[0]?.id).toBe('new-org');
  });

  it('distinguishes pending, failed, no execution, successful execution and failed execution metadata', async () => {
    const run = deferred<Awaited<ReturnType<typeof getLastBackupRun>>>();
    vi.mocked(getLastBackupRun).mockReturnValueOnce(run.promise);
    const { result } = await mount();
    expect(result.current.lastRunLoading).toBe(true);
    expect(result.current.lastRunLoaded).toBe(false);
    await act(async () => { run.resolve(failure); });
    expect(result.current.lastRunError).toBe('取得できませんでした');
    expect(result.current.lastRunLoaded).toBe(false);
    await act(() => result.current.retryLastRun());
    expect(result.current.lastRunLoaded).toBe(true);
    expect(result.current.lastRun).toBeNull();
    for (const outcome of ['success', 'failure'] as const) {
      vi.mocked(getLastBackupRun).mockResolvedValueOnce(ok({ createdAt: '2026-10-23T00:00:00Z', outcome, details: null }));
      await act(() => result.current.retryLastRun());
      expect(result.current.lastRun?.outcome).toBe(outcome);
      expect(result.current.lastRunError).toBeNull();
    }
  });

  it('preserves selection changed during manual backup and its list refresh', async () => {
    const trigger = deferred<Awaited<ReturnType<typeof triggerDailyBackup>>>();
    const refresh = deferred<Awaited<ReturnType<typeof listDailyBackups>>>();
    vi.mocked(triggerDailyBackup).mockReturnValueOnce(trigger.promise);
    const { result } = await mount();
    const notify = vi.fn();
    act(() => { void result.current.triggerBackup(notify); });
    act(() => result.current.selectBackup('B'));
    vi.mocked(listDailyBackups).mockReturnValueOnce(refresh.promise);
    await act(async () => { trigger.resolve(ok({ date: files[0].date, path: 'C', records: 1 })); });
    await act(async () => { refresh.resolve(ok({ configured: true, files: [file('C'), ...files] })); });
    expect(result.current.selectedBackupPath).toBe('B');
    expect(result.current.triggering).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('ignores superseded list and run retries, including their loading and errors', async () => {
    const { result } = await mount();
    const oldFiles = deferred<Awaited<ReturnType<typeof listDailyBackups>>>();
    const oldRun = deferred<Awaited<ReturnType<typeof getLastBackupRun>>>();
    vi.mocked(listDailyBackups).mockReturnValueOnce(oldFiles.promise);
    vi.mocked(getLastBackupRun).mockReturnValueOnce(oldRun.promise);
    act(() => { void result.current.retryFiles(); void result.current.retryLastRun(); });
    await act(async () => { await result.current.retryFiles(); await result.current.retryLastRun(); });
    await act(async () => { oldFiles.resolve(failure); oldRun.resolve(failure); });
    expect(result.current.filesError).toBeNull();
    expect(result.current.loadingFiles).toBe(false);
    expect(result.current.lastRunError).toBeNull();
    expect(result.current.lastRunLoaded).toBe(true);
  });

  it('keeps a newer record error when an older request fails later', async () => {
    const old = deferred<Awaited<ReturnType<typeof getBackupRecords>>>();
    vi.mocked(getBackupRecords).mockReturnValueOnce(old.promise).mockResolvedValue(failure);
    const { result } = await mount();
    act(() => result.current.selectBackup('B'));
    await waitFor(() => expect(result.current.recordsError).toBe('取得できませんでした'));
    await act(async () => { old.reject(new Error('private detail')); });
    expect(result.current.recordsError).toBe('取得できませんでした');
    expect(result.current.loadingRecords).toBe(false);
  });

  it('does not revive manual loading or notify after changing organization', async () => {
    const trigger = deferred<Awaited<ReturnType<typeof triggerDailyBackup>>>();
    vi.mocked(triggerDailyBackup).mockReturnValueOnce(trigger.promise);
    const { result, rerender } = await mount();
    const notify = vi.fn();
    act(() => { void result.current.triggerBackup(notify); });
    expect(result.current.triggering).toBe(true);
    rerender({ org: 'org-b' });
    expect(result.current.triggering).toBe(false);
    rerender({ org: 'org-a' });
    expect(result.current.triggering).toBe(false);
    await act(async () => { trigger.resolve(ok({ date: '', path: 'C', records: 1 })); });
    expect(notify).not.toHaveBeenCalled();
  });

  it('invalidates pending file retries on unmount', async () => {
    const pending = deferred<Awaited<ReturnType<typeof listDailyBackups>>>();
    const { result, unmount } = await mount();
    vi.mocked(listDailyBackups).mockReturnValueOnce(pending.promise);
    act(() => { void result.current.retryFiles(); });
    unmount();
    await act(async () => { pending.resolve(ok({ configured: true, files: [file('late')] })); });
    expect(getBackupRecords).not.toHaveBeenCalledWith('org-a', 'late');
  });

  it('ignores pending requests and manual completion after unmount', async () => {
    const a = deferred<Awaited<ReturnType<typeof getBackupRecords>>>();
    const run = deferred<Awaited<ReturnType<typeof getLastBackupRun>>>();
    const trigger = deferred<Awaited<ReturnType<typeof triggerDailyBackup>>>();
    vi.mocked(getBackupRecords).mockReturnValueOnce(a.promise);
    vi.mocked(getLastBackupRun).mockReturnValueOnce(run.promise);
    vi.mocked(triggerDailyBackup).mockReturnValueOnce(trigger.promise);
    const { result, unmount } = await mount();
    const notify = vi.fn();
    act(() => { void result.current.triggerBackup(notify); });
    unmount();
    await act(async () => { a.resolve(failure); run.resolve(failure); trigger.resolve(ok({ date: '', path: 'C', records: 1 })); });
    expect(notify).not.toHaveBeenCalled();
    expect(listDailyBackups).toHaveBeenCalledTimes(1);
  });
});
