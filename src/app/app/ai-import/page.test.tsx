// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ui/mui';
import theme from '@/theme';
import type { AiExtractSseEvent } from '@/lib/ai/sseClient';
import type { AiImportReviewTableProps } from '@/components/ui/AiImportReviewTable';
import { subscribeRecordFeed } from '@/utils/recordFeedUpdates';
const state = vi.hoisted(() => ({ back: vi.fn(), reader: vi.fn(), save: vi.fn(), toast: vi.fn(), dismiss: vi.fn(), confirm: vi.fn(), org: { id: 'org-1' }, candidates: vi.fn(), retryCandidates: null as null | (() => Promise<void>), review: null as AiImportReviewTableProps | null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: state.back }) }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({ currentOrg: state.org }) }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: state.toast, dismissToast: state.dismiss }) }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/app/actions/reports', () => ({ saveReport: state.save }));
vi.mock('@/lib/ai/sseClient', () => ({ readAiExtractSse: state.reader }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const query = { select: () => query, eq: () => query, is: () => query, order: () => state.candidates(table) }; return query;
} } }));
vi.mock('@/hooks/useAiImportCandidates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAiImportCandidates')>();
  return { ...actual, useAiImportCandidates: (organizationId: string | undefined) => {
    const result = actual.useAiImportCandidates(organizationId);
    state.retryCandidates = result.retry;
    return result;
  } };
});
// Exercise the page's real submission handlers; row editing is covered by the
// actual table tests and Storybook, without duplicating its UI here.
vi.mock('@/components/ui/AiImportReviewTable', () => ({ AiImportReviewTable: (props: AiImportReviewTableProps) => {
  state.review = props;
  return <div>{props.rows.map((row) => <div key={row.id} data-testid={row.fileName}>{row.result?.values.note as string}:{row.saveStatus ?? row.status}</div>)}</div>;
} }));
import Page from './page';
const record = (index: number): AiExtractSseEvent => ({ type: 'record', index, fileIndex: index, result: { meta: { date: '2026-10-02', start_at: '09:00', end_at: '10:00', client_name: '利用者', helper_names: ['担当'], client_id_candidate: 'client-1', helper_id_candidates: ['helper-1'] }, values: { note: `入力${index}` }, confidence: 'high', warnings: [] } });
let unsubscribe: (() => void) | undefined;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); unsubscribe?.(); });
beforeEach(() => { vi.clearAllMocks(); state.org = { id: 'org-1' }; state.review = null; state.candidates.mockImplementation(async (table: string) => ({ data: [{ id: table === 'clients' ? 'client-1' : 'helper-1', name: table === 'clients' ? '利用者' : '担当' }], error: null })); state.confirm.mockResolvedValue(true); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: {} })); });
let rendered: ReturnType<typeof render>;
async function extract() {
  state.reader.mockImplementationOnce(async (_: unknown, emit: (event: AiExtractSseEvent) => void) => { emit(record(0)); emit(record(1)); });
  rendered = render(<ThemeProvider theme={theme}><Page /></ThemeProvider>);
  fireEvent.change(screen.getByLabelText('記録ファイル'), { target: { files: [new File(['a'], 'a.pdf', { type: 'application/pdf' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })] } });
  // Candidate lookup finishes before starting extraction.
  await waitFor(() => expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
  await waitFor(() => expect(state.review?.rows).toHaveLength(2));
  const rows = state.review!.rows;
  act(() => rows.forEach((row) => state.review!.onRowChange(row.id, { status: 'confirmed' })));
  return rows.map((row) => row.id);
}
describe('AI batch lifecycle', () => {
  it('retains failed rows, retries only those rows with the same key, and keeps the existing feed boundary', async () => {
    const ids = await extract(); const refresh = vi.fn().mockResolvedValue(undefined); unsubscribe = subscribeRecordFeed('org-1', refresh);
    let finish!: (value: unknown) => void;
    state.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValueOnce(new Error('offline'));
    let first!: Promise<void>;
    await act(async () => { first = state.review!.onSaveSelected(ids); await state.review!.onSaveSelected(ids); });
    expect(state.save).toHaveBeenCalledTimes(2); expect(state.review!.saving).toBe(true); expect(refresh).not.toHaveBeenCalled();
    await act(async () => { finish({ ok: true, data: { reportId: 'report-a', version: 1 } }); await first; });
    expect(state.review!.saving).toBe(false); expect(state.review!.rows.map((row) => row.saveStatus)).toEqual(['saved', 'error']);
    expect(state.review!.rows[1].result!.values.note).toBe('入力1'); expect(state.review!.rows[1].saveError).toContain('再試行');
    expect(state.toast).toHaveBeenLastCalledWith(expect.stringContaining('1 件を保存、1 件'), 'warning'); expect(refresh).toHaveBeenCalledOnce();
    const key = state.save.mock.calls[1][0].idempotencyKey;
    state.save.mockResolvedValueOnce({ ok: true, data: { reportId: 'report-b', version: 1 } });
    await act(async () => { await state.review!.onSaveSelected(ids); });
    expect(state.save).toHaveBeenCalledTimes(3); expect(state.save.mock.calls[2][0].idempotencyKey).toBe(key);
    expect(state.review!.rows.map((row) => row.saveStatus)).toEqual(['saved', 'saved']); expect(refresh).toHaveBeenCalledTimes(2);
    expect(state.toast).toHaveBeenLastCalledWith('1 件を下書き保存しました', 'success');
    await act(async () => { await state.review!.onSaveSelected(ids); }); expect(state.save).toHaveBeenCalledTimes(3);
  });
  it('keeps corrected rows on a failed re-extraction and clears busy state', async () => {
    await extract(); const row = state.review!.rows[0];
    act(() => state.review!.onRowChange(row.id, { result: { ...row.result!, values: { note: '修正済みの内容' } } }));
    state.reader.mockImplementationOnce(async (_: unknown, emit: (event: AiExtractSseEvent) => void) => { emit(record(0)); emit({ type: 'error', fileIndex: 1, message: 'private diagnostic' }); });
    fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
    await waitFor(() => expect(state.toast).toHaveBeenLastCalledWith(expect.stringContaining('ファイルと入力内容は保持'), 'error'));
    expect(state.review!.rows[0].result!.values.note).toBe('修正済みの内容'); expect(state.review!.rows).toHaveLength(2); expect(state.review!.saving).toBe(false);
    expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', false);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const view = () => <ThemeProvider theme={theme}><Page /></ThemeProvider>;
const chooseFile = () => fireEvent.change(screen.getByLabelText('記録ファイル'), { target: { files: [new File(['a'], 'retained.pdf', { type: 'application/pdf' })] } });
describe('candidate readiness', () => {
  it.each(['clients', 'staffs'])('blocks extraction until %s completes, then distinguishes failure and retries without clearing files', async (table) => {
    const slow = deferred<{ data: null; error: { message: string } }>();
    const normal = state.candidates.getMockImplementation()!;
    state.candidates.mockImplementation((name: string) => name === table ? slow.promise : normal(name));
    render(view()); chooseFile();
    expect(screen.getByText(/候補を取得中/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => expect(state.candidates).toHaveBeenCalledTimes(2));
    await act(async () => slow.resolve({ data: null, error: { message: 'private diagnostic' } }));
    expect(screen.getByText(/候補を取得できませんでした/)).toBeTruthy();
    expect(screen.queryByText(/候補が登録されていません/)).toBeNull();
    expect(screen.queryByText(/private diagnostic/)).toBeNull();
    expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', true);
    state.candidates.mockImplementation(normal);
    fireEvent.click(screen.getByRole('button', { name: '候補を再取得' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', false));
    expect(screen.getByText('retained.pdf')).toBeTruthy();
    state.reader.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect((vi.mocked(fetch).mock.calls[0][1]!.body as FormData).getAll('files[]')).toHaveLength(1);
  });
  it.each(['clients', 'staffs'])('treats successful empty %s as loaded', async (table) => {
    const normal = state.candidates.getMockImplementation()!;
    state.candidates.mockImplementation((name: string) => name === table ? Promise.resolve({ data: [], error: null }) : normal(name));
    render(view()); chooseFile();
    await waitFor(() => expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', false));
    expect(screen.getByText(/候補が登録されていません/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '候補を再取得' })).toBeNull();
  });
  it('blocks handler-level saves during loading and failure, retaining reviewed input on retry', async () => {
    const ids = await extract();
    const row = state.review!.rows[0];
    act(() => state.review!.onRowChange(row.id, { result: { ...row.result!, values: { note: 'レビュー修正' } } }));
    const slow = deferred<{ data: null; error: { message: string } }>();
    state.candidates.mockReturnValue(slow.promise);
    let retry!: Promise<void>;
    act(() => { retry = state.retryCandidates!(); });
    expect(state.review!.saving).toBe(true);
    await act(async () => { await state.review!.onSaveSelected(ids); });
    expect(state.save).not.toHaveBeenCalled();
    await act(async () => { slow.resolve({ data: null, error: { message: 'private' } }); await retry; });
    await act(async () => { await state.review!.onSaveSelected(ids); });
    expect(state.save).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    state.candidates.mockImplementation(async (table: string) => ({ data: [{ id: table === 'clients' ? 'client-1' : 'helper-1', name: '復旧候補' }], error: null }));
    fireEvent.click(screen.getByRole('button', { name: '候補を再取得' }));
    await waitFor(() => expect(state.review!.saving).toBe(false));
    expect(state.review!.rows[0].result!.values.note).toBe('レビュー修正');
    expect(screen.getByText('a.pdf')).toBeTruthy();
    state.save.mockResolvedValue({ ok: true, data: { reportId: 'saved', version: 1 } });
    await act(async () => { await state.review!.onSaveSelected(ids); });
    expect(state.save).toHaveBeenCalledTimes(2);
  });
  it('discards files and reviewed rows on organization change and gates the new scope', async () => {
    const scoped = render(view());
    chooseFile();
    state.reader.mockImplementationOnce(async (_: unknown, emit: (event: AiExtractSseEvent) => void) => emit(record(0)));
    await waitFor(() => expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
    await waitFor(() => expect(state.review?.rows).toHaveLength(1));
    const slow = deferred<{ data: []; error: null }>();
    state.org = { id: 'org-2' }; state.candidates.mockReturnValue(slow.promise);
    scoped.rerender(view());
    expect(screen.queryByText('retained.pdf')).toBeNull();
    expect(screen.queryByTestId('retained.pdf')).toBeNull();
    expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', true);
    await act(async () => slow.resolve({ data: [], error: null }));
    expect(screen.queryByTestId('retained.pdf')).toBeNull();
  });
});

describe('split operations share one lifecycle', () => {
  it('keeps initial completed rows when the SSE transport fails midway, with grouped fileIndex mapping and progress', async () => {
    const stream = deferred<void>();
    let emit!: (event: AiExtractSseEvent) => void;
    state.reader.mockImplementationOnce(async (_: unknown, receive: typeof emit) => { emit = receive; await stream.promise; throw new Error('transport failed'); });
    render(view());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    fireEvent.change(screen.getByLabelText('記録ファイル'), { target: { files: [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' }), new File(['c'], 'c.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'b.pngを選択' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'a.pngを選択' }));
    fireEvent.click(screen.getByRole('button', { name: '1記録としてまとめる' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
    await waitFor(() => expect(state.reader).toHaveBeenCalledOnce());
    const data = vi.mocked(fetch).mock.calls[0][1]!.body as FormData;
    expect(JSON.parse(data.get('grouping') as string)).toEqual([[1, 0], [2]]);
    act(() => { emit(record(1)); emit({ type: 'group_done', fileIndex: 1 }); });
    expect(screen.getByText('1 / 2 件処理中...')).toBeTruthy();
    await act(async () => stream.resolve());
    await waitFor(() => expect(state.review?.rows).toHaveLength(1));
    expect(state.review!.rows[0]).toMatchObject({ fileIndex: 1, fileName: 'b.png', fileCount: 2, previewUrl: 'blob:preview' });
    fireEvent.click(screen.getByRole('button', { name: 'b.pngを削除' }));
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    expect(revoke).toHaveBeenCalledWith('blob:preview');
    vi.restoreAllMocks();
  });
  it('blocks extraction, saving, editing and close during re-extraction confirmation and stream work', async () => {
    const ids = await extract();
    const confirmation = deferred<boolean>(); const stream = deferred<void>();
    state.confirm.mockReturnValueOnce(confirmation.promise);
    state.reader.mockImplementationOnce(async () => stream.promise);
    fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
    expect(state.confirm).toHaveBeenCalledOnce();
    const before = state.review!.rows;
    await act(async () => {
      await state.review!.onSaveSelected(ids);
      state.review!.onRowChange(ids[0], { date: '2026-10-24' });
    });
    expect(state.review!.rows).toEqual(before);
    expect(state.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /閉じる/ })).toHaveProperty('disabled', true);
    await act(async () => confirmation.resolve(true));
    await waitFor(() => expect(state.reader).toHaveBeenCalledTimes(2));
    await act(async () => { await state.review!.onSaveSelected(ids); });
    expect(state.save).not.toHaveBeenCalled();
    await act(async () => stream.resolve());
    await waitFor(() => expect(state.review!.saving).toBe(false));
  });
  it('locks close confirmation against processing and saving, and keeps input on cancellation', async () => {
    const ids = await extract(); const confirmation = deferred<boolean>();
    state.confirm.mockReturnValueOnce(confirmation.promise);
    fireEvent.click(screen.getByRole('button', { name: /閉じる/ }));
    await act(async () => { await state.review!.onSaveSelected(ids); });
    fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
    expect(state.save).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce(); expect(state.back).not.toHaveBeenCalled();
    await act(async () => confirmation.resolve(false));
    expect(state.review!.rows).toHaveLength(2); expect(state.review!.saving).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /閉じる/ }));
    await waitFor(() => expect(state.back).toHaveBeenCalledOnce());
  });
  it.each(['transport', 'group'])('preserves edited rows after a failed re-extraction (%s)', async (failure) => {
    const ids = await extract();
    act(() => state.review!.onRowChange(ids[0], { date: '2026-10-24' }));
    const before = state.review!.rows;
    state.reader.mockImplementationOnce(async (_: unknown, emit: (event: AiExtractSseEvent) => void) => {
      emit(record(0));
      if (failure === 'transport') throw new Error('offline');
      emit({ type: 'error', fileIndex: 1, message: 'private' });
    });
    fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
    await waitFor(() => expect(state.toast).toHaveBeenLastCalledWith(expect.stringContaining('ファイルと入力内容は保持'), 'error'));
    expect(state.review!.rows).toEqual(before);
  });
  it.each(['extract', 'save', 'close'])('ignores old %s results after switching organization', async (kind) => {
    const ids = await extract();
    // Observe the keyed workspace through a parent refresh.
    const slow = deferred<unknown>();
    let emit!: (event: AiExtractSseEvent) => void;
    let operation: Promise<void> | undefined;
    if (kind === 'extract') {
      state.reader.mockImplementationOnce(async (_: unknown, receive: typeof emit) => { emit = receive; await slow.promise; emit(record(0)); emit({ type: 'group_done', fileIndex: 0 }); });
      fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
      await waitFor(() => expect(state.reader).toHaveBeenCalledTimes(2));
    } else if (kind === 'save') {
      state.save.mockImplementation(() => slow.promise);
      act(() => { operation = state.review!.onSaveSelected(ids); });
    } else {
      state.confirm.mockReturnValueOnce(slow.promise);
      fireEvent.click(screen.getByRole('button', { name: /閉じる/ }));
    }
    state.org = { id: 'org-2' }; state.review = null; state.toast.mockClear();
    rendered.rerender(view()); chooseFile();
    await act(async () => { slow.resolve(kind === 'close' ? true : { ok: true, data: { reportId: 'saved', version: 1 } }); await operation; });
    await waitFor(() => expect(screen.queryByText(/候補を取得中/)).toBeNull());
    expect(state.review).toBeNull(); expect(state.toast).not.toHaveBeenCalled(); expect(state.back).not.toHaveBeenCalled();
    expect(screen.getByText('retained.pdf')).toBeTruthy(); expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('save retry boundaries', () => {
  it('does not refresh the feed when every row fails and changes the key only for edited payloads', async () => {
    const ids = await extract();
    const refresh = vi.fn().mockResolvedValue(undefined); unsubscribe = subscribeRecordFeed('org-1', refresh);
    state.save.mockResolvedValue({ ok: false, code: 'UNEXPECTED_ERROR', message: 'private' });
    await act(async () => { await state.review!.onSaveSelected(ids); });
    expect(refresh).not.toHaveBeenCalled();
    const original = state.save.mock.calls.map(([payload]) => payload.idempotencyKey);
    act(() => state.review!.onRowChange(ids[0], { date: '2026-10-24' }));
    await act(async () => { await state.review!.onSaveSelected(ids); });
    expect(state.save.mock.calls[2][0].idempotencyKey).not.toBe(original[0]);
    expect(state.save.mock.calls[3][0].idempotencyKey).toBe(original[1]);
    expect(refresh).not.toHaveBeenCalled();
    expect(state.review!.rows.every((row) => row.saveStatus === 'error')).toBe(true);
  });
  it('blocks extraction, editing, clearing and closing while saving', async () => {
    const ids = await extract(); const response = deferred<unknown>();
    state.save.mockReturnValue(response.promise);
    let saving!: Promise<void>;
    act(() => { saving = state.review!.onSaveSelected(ids); });
    const before = state.review!.rows;
    act(() => state.review!.onRowChange(ids[0], { date: '2026-10-24' }));
    for (const name of ['処理開始', 'クリア', /閉じる/]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveProperty('disabled', true); fireEvent.click(button);
    }
    expect(fetch).toHaveBeenCalledOnce(); expect(state.back).not.toHaveBeenCalled(); expect(state.review!.rows).toEqual(before);
    await act(async () => { response.resolve({ ok: true, data: { reportId: 'saved', version: 1 } }); await saving; });
    expect(state.review!.saving).toBe(false);
  });
});
