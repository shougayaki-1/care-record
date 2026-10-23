// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ui/mui';
import theme from '@/theme';
import type { AiExtractSseEvent } from '@/lib/ai/sseClient';
import type { AiImportReviewTableProps } from '@/components/ui/AiImportReviewTable';
import { subscribeRecordFeed } from '@/utils/recordFeedUpdates';
const state = vi.hoisted(() => ({ reader: vi.fn(), save: vi.fn(), toast: vi.fn(), dismiss: vi.fn(), confirm: vi.fn(), org: { id: 'org-1' }, candidates: vi.fn(), retryCandidates: null as null | (() => Promise<void>), review: null as AiImportReviewTableProps | null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));
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
async function extract() {
  state.reader.mockImplementationOnce(async (_: unknown, emit: (event: AiExtractSseEvent) => void) => { emit(record(0)); emit(record(1)); });
  render(<ThemeProvider theme={theme}><Page /></ThemeProvider>);
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
