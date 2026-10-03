// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './mui';
import theme from '@/theme';
import { AiImportButton } from './AiImportButton';
import type { AiExtractSseEvent } from '@/lib/ai/sseClient';
const { reader, toast, dismiss } = vi.hoisted(() => ({ reader: vi.fn(), toast: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/lib/ai/sseClient', () => ({ readAiExtractSse: reader }));
vi.mock('./ToastProvider', () => ({ useToast: () => ({ showToast: toast, dismissToast: dismiss }) }));
const record: AiExtractSseEvent = { type: 'record', index: 0, fileIndex: 0, result: { meta: { date: '2026-10-02', start_at: '09:00', end_at: '10:00', client_name: '利用者', helper_names: [], client_id_candidate: null, helper_id_candidates: [] }, values: { note: '確認対象' }, confidence: 'high', warnings: [] } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: {}, json: async () => ({ provider: 'gemini', model: 'test-model' }) })); });
const extractionRequests = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/ai/extract'));
function open() {
  const onExtracted = vi.fn(); const onProcessingChange = vi.fn(); render(<ThemeProvider theme={theme}><AiImportButton organizationId="org-1" formTemplate={[]} clients={[]} helpers={[]} onExtracted={onExtracted} onProcessingChange={onProcessingChange} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'AIで読み取り' }));
  const dialog = screen.getByRole('dialog', { name: 'AIで記録を読み取る' });
  fireEvent.change(within(dialog).getByLabelText('記録ファイル'), { target: { files: [new File(['test'], 'retry.pdf', { type: 'application/pdf' })] } });
  return { dialog, onExtracted, onProcessingChange };
}
describe('single AI extraction lifecycle', () => {
  it('waits for the complete stream, blocks repeat submission and close, then applies one result', async () => {
    let finish!: () => void;
    reader.mockImplementation(async (_: unknown, onEvent: (event: AiExtractSseEvent) => void) => { onEvent(record); await new Promise<void>((resolve) => { finish = resolve; }); });
    const { dialog, onExtracted, onProcessingChange } = open(); const start = within(dialog).getByRole('button', { name: '処理開始' });
    fireEvent.click(start); fireEvent.click(start);
    await waitFor(() => expect(reader).toHaveBeenCalledOnce());
    expect(onProcessingChange).toHaveBeenLastCalledWith(true); expect(extractionRequests()).toHaveLength(1); expect(onExtracted).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: /読み取り中/ }).getAttribute('aria-busy')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(dialog, { key: 'Escape' }); expect(screen.getByRole('dialog', { name: 'AIで記録を読み取る' })).toBeTruthy();
    await act(async () => { finish(); });
    await waitFor(() => expect(onExtracted).toHaveBeenCalledExactlyOnceWith(record.result));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AIで記録を読み取る' })).toBeNull());
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('読み取り結果'), 'success'); expect(onProcessingChange).toHaveBeenLastCalledWith(false);
  });
  it('does not overwrite input on a late stream error and retries using the retained file', async () => {
    reader.mockImplementationOnce(async (_: unknown, onEvent: (event: AiExtractSseEvent) => void) => { onEvent(record); onEvent({ type: 'error', fileIndex: 0, message: 'private diagnostic' }); });
    const { dialog, onExtracted } = open(); fireEvent.click(within(dialog).getByRole('button', { name: '処理開始' }));
    await waitFor(() => expect(within(dialog).getByText(/ファイルと入力内容は保持/)).toBeTruthy());
    expect(onExtracted).not.toHaveBeenCalled(); expect(within(dialog).getByText('retry.pdf')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '処理開始' })).toHaveProperty('disabled', false);
    reader.mockImplementationOnce(async (_: unknown, onEvent: (event: AiExtractSseEvent) => void) => { onEvent(record); });
    fireEvent.click(within(dialog).getByRole('button', { name: '処理開始' }));
    await waitFor(() => expect(onExtracted).toHaveBeenCalledOnce()); expect(extractionRequests()).toHaveLength(2); expect(dismiss).toHaveBeenCalledTimes(2);
    const body = extractionRequests()[1][1]?.body as FormData; expect((body.get('files[]') as File).name).toBe('retry.pdf');
  });
});
