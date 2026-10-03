// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiImportReviewTable, type ReviewRow } from './AiImportReviewTable';

const row: ReviewRow = {
  id: 'row-1', fileIndex: 0, fileName: 'sample.pdf', fileType: 'application/pdf',
  previewUrl: null, fileCount: 1,
  result: {
    meta: {
      date: '2026-09-25', start_at: '09:00', end_at: '10:00', client_name: '利用者',
      helper_names: ['スタッフ'], client_id_candidate: 'client-1', helper_id_candidates: ['helper-1'],
    },
    values: { note: '記録内容' }, confidence: 'high', warnings: [],
  },
  date: '2026-09-25', startAt: '09:00', endAt: '10:00',
  travelTime: '2',
  clientId: 'client-1', helperId: 'helper-1', status: 'pending',
};

afterEach(cleanup);

describe('AiImportReviewTable', () => {
  it('requires opening the source review before confirming even a high confidence result', () => {
    const onRowChange = vi.fn();
    render(<AiImportReviewTable
      rows={[row]}
      clients={[{ id: 'client-1', name: '利用者' }]}
      helpers={[{ id: 'helper-1', name: 'スタッフ' }]}
      formTemplate={[{ id: 'note', label: '特記事項', type: 'text', required: false }]}
      onRowChange={onRowChange}
      onSaveSelected={vi.fn()}
      saving={false}
    />);

    expect(screen.getByRole('button', { name: '選択した記録を下書き保存' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getAllByRole('button', { name: '内容を確認・修正' })[0]);
    expect(screen.getByDisplayValue('記録内容')).toBeTruthy();
    expect(screen.getByDisplayValue('2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '原本と照合して確認済みにする' }));
    expect(onRowChange).toHaveBeenCalledWith('row-1', { status: 'confirmed' });
  });

  it('marks MCP readings as unverified and explains where the source PDF is', () => {
    render(<AiImportReviewTable
      rows={[{ ...row, sourceKind: 'ai_chat' }]}
      clients={[{ id: 'client-1', name: '利用者' }]}
      helpers={[{ id: 'helper-1', name: 'スタッフ' }]}
      formTemplate={[{ id: 'note', label: '特記事項', type: 'text', required: false }]}
      onRowChange={vi.fn()}
      onSaveSelected={vi.fn()}
      saving={false}
    />);
    expect(screen.getAllByText(/原本要確認/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: '内容を確認・修正' })[0]);
    expect(screen.getByText(/原本PDFはこの画面に保存されていません/)).toBeTruthy();
  });

  it('shows an AI warning beside its matching form field', () => {
    render(<AiImportReviewTable
      rows={[{ ...row, result: { ...row.result!, warnings: ['特記事項: 文字が不鮮明です', '原本全体の確認が必要です'] } }]}
      clients={[{ id: 'client-1', name: '利用者' }]}
      helpers={[{ id: 'helper-1', name: 'スタッフ' }]}
      formTemplate={[{ id: 'note', label: '特記事項', type: 'text', required: false }]}
      onRowChange={vi.fn()}
      onSaveSelected={vi.fn()}
      saving={false}
    />);
    fireEvent.click(screen.getAllByRole('button', { name: '内容を確認・修正' })[0]);
    expect(screen.getByText('特記事項: 文字が不鮮明です')).toBeTruthy();
    expect(screen.getByText('原本全体の確認が必要です')).toBeTruthy();
    expect(screen.queryByText('AIが確定できなかった項目です')).toBeNull();
  });

  it('sends a submitted AI record to approval from the review dialog without a draft step', async () => {
    const onApproveRow = vi.fn().mockResolvedValue(true);
    render(<AiImportReviewTable
      rows={[{ ...row, sourceKind: 'ai_chat', travelMethod: 'none', travelCostYen: '0' }]}
      clients={[{ id: 'client-1', name: '利用者' }]}
      helpers={[{ id: 'helper-1', name: 'スタッフ' }]}
      formTemplate={[{ id: 'note', label: '特記事項', type: 'text', required: false }]}
      onRowChange={vi.fn()}
      onSaveSelected={vi.fn()}
      onApproveRow={onApproveRow}
      workflow="review_submissions"
      saving={false}
    />);
    expect(screen.getAllByText('送信済み・要確認').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '選択した記録を下書き保存' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '内容を確認・修正' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '内容を確認して承認' }));
    await waitFor(() => expect(onApproveRow).toHaveBeenCalledWith('row-1'));
  });
  it('keeps the review action in the shared header and displays required selectors with labels', () => {
    render(<AiImportReviewTable
      rows={[{ ...row, clientId: null, helperId: null }]}
      clients={[{ id: 'client-1', name: '利用者' }]} helpers={[{ id: 'helper-1', name: 'スタッフ' }]}
      formTemplate={[]} onRowChange={vi.fn()} onSaveSelected={vi.fn()} saving={false}
    />);
    fireEvent.click(screen.getAllByRole('button', { name: '内容を確認・修正' })[0]);
    const dialog = screen.getByRole('dialog', { name: '提供記録の確認・修正' });
    const actions = within(dialog).getByRole('group', { name: '記録操作' });
    expect(within(actions).getByRole('button', { name: '原本と照合して確認済みにする' })).toHaveProperty('disabled', true);
    expect(within(dialog).getByLabelText(/利用者/).getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByLabelText(/担当スタッフ/)).toBeTruthy();
    expect(within(dialog).getByText('利用者を選択してください')).toBeTruthy();
    expect(within(dialog).getByText('スタッフを選択してください')).toBeTruthy();
  });

  it('disables the submitted record inputs and shared action while saving', () => {
    const view = (saving: boolean) => <AiImportReviewTable
      rows={[{ ...row, travelMethod: 'none', travelCostYen: '0' }]}
      clients={[{ id: 'client-1', name: '利用者' }]} helpers={[{ id: 'helper-1', name: 'スタッフ' }]}
      formTemplate={[]} onRowChange={vi.fn()} onSaveSelected={vi.fn()} workflow="review_submissions" saving={saving}
    />;
    const { rerender } = render(view(false));
    fireEvent.click(screen.getAllByRole('button', { name: '内容を確認・修正' })[0]);
    const dialog = screen.getByRole('dialog', { name: '提供記録の確認・修正' });
    rerender(view(true));
    expect(screen.getAllByRole('button', { name: '内容を確認・修正', hidden: true })[0]).toHaveProperty('disabled', true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '提供記録の確認・修正' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /内容を確認して承認/ })).toHaveProperty('disabled', true);
    expect(within(dialog).getByLabelText('記録日')).toHaveProperty('disabled', true);
    expect(within(dialog).getByRole('spinbutton', { name: '交通費' })).toHaveProperty('disabled', true);
    expect(within(dialog).getByLabelText('移動時間').parentElement?.querySelector('.MuiInputAdornment-positionEnd')?.textContent).toBe('時間');
    expect(within(dialog).getByRole('spinbutton', { name: '交通費' }).parentElement?.querySelector('.MuiInputAdornment-positionEnd')?.textContent).toBe('円');
  });

});
