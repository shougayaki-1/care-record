// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ui/mui';
import theme from '@/theme';
import type { AiExtractSseEvent } from '@/lib/ai/sseClient';
import type { AiImportReviewTableProps } from '@/components/ui/AiImportReviewTable';
import { subscribeRecordFeed } from '@/utils/recordFeedUpdates';
const state = vi.hoisted(() => ({ reader: vi.fn(), save: vi.fn(), toast: vi.fn(), dismiss: vi.fn(), confirm: vi.fn(), org: { id: 'org-1' }, review: null as AiImportReviewTableProps | null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('@/context/WorkspaceContext', () => ({ useWorkspace: () => ({ currentOrg: state.org }) }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: state.toast, dismissToast: state.dismiss }) }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/app/actions/reports', () => ({ saveReport: state.save }));
vi.mock('@/lib/ai/sseClient', () => ({ readAiExtractSse: state.reader }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const query = { select: () => query, eq: () => query, is: () => query, order: async () => ({ data: [{ id: table === 'clients' ? 'client-1' : 'helper-1', name: table === 'clients' ? '利用者' : '担当' }] }) }; return query;
} } }));
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
beforeEach(() => { vi.clearAllMocks(); state.review = null; state.confirm.mockResolvedValue(true); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: {}, json: async () => ({ provider: 'gemini', model: 'test-model' }) })); });
async function extract() {
  state.reader.mockImplementationOnce(async (_: unknown, emit: (event: AiExtractSseEvent) => void) => { emit(record(0)); emit(record(1)); });
  render(<ThemeProvider theme={theme}><Page /></ThemeProvider>);
  fireEvent.change(screen.getByLabelText('記録ファイル'), { target: { files: [new File(['a'], 'a.pdf', { type: 'application/pdf' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })] } });
  // Candidate lookup finishes before starting extraction.
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '処理開始' }));
  await waitFor(() => expect(state.review?.rows).toHaveLength(2));
  const rows = state.review!.rows;
  act(() => rows.forEach((row) => state.review!.onRowChange(row.id, { status: 'confirmed' })));
  return rows.map((row) => row.id);
}
describe('AI batch lifecycle', () => {
  it('requires review again after editing a confirmed row', async () => {
    const ids = await extract();
    const row = state.review!.rows[0];
    act(() => state.review!.onRowChange(row.id, { travelTime: '0.5' }));
    expect(state.review!.rows[0].status).toBe('pending');
    state.save.mockResolvedValue({ reportId: 'report', version: 1 });
    await act(async () => { await state.review!.onSaveSelected([ids[0]]); });
    expect(state.save).not.toHaveBeenCalled();
    act(() => state.review!.onRowChange(row.id, { status: 'confirmed' }));
    await act(async () => { await state.review!.onSaveSelected([ids[0]]); });
    expect(state.save.mock.calls[0][0].values.travel_time).toBe('0.5');
    expect(state.review!.rows[0].sourceFiles).toHaveLength(1);
  });
  it('retains failed rows, retries only those rows with the same key, and keeps the existing feed boundary', async () => {
    const ids = await extract(); const refresh = vi.fn().mockResolvedValue(undefined); unsubscribe = subscribeRecordFeed('org-1', refresh);
    let finish!: (value: unknown) => void;
    state.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValueOnce(new Error('offline'));
    let first!: Promise<void>;
    await act(async () => { first = state.review!.onSaveSelected(ids); await state.review!.onSaveSelected(ids); });
    expect(state.save).toHaveBeenCalledTimes(2); expect(state.review!.saving).toBe(true); expect(refresh).not.toHaveBeenCalled();
    await act(async () => { finish({ reportId: 'report-a', version: 1 }); await first; });
    expect(state.review!.saving).toBe(false); expect(state.review!.rows.map((row) => row.saveStatus)).toEqual(['saved', 'error']);
    expect(state.review!.rows[1].result!.values.note).toBe('入力1'); expect(state.review!.rows[1].saveError).toContain('再試行');
    expect(state.toast).toHaveBeenLastCalledWith(expect.stringContaining('1 件を保存、1 件'), 'warning'); expect(refresh).toHaveBeenCalledOnce();
    const key = state.save.mock.calls[1][0].idempotencyKey;
    state.save.mockResolvedValueOnce({ reportId: 'report-b', version: 1 });
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
