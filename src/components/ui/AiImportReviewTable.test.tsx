// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    fireEvent.click(screen.getByRole('button', { name: '内容を確認・修正' }));
    expect(screen.getByText('記録内容')).toBeTruthy();
    expect(screen.getByText('移動時間: 2 時間')).toBeTruthy();
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
    expect(screen.getByText(/原本要確認/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '内容を確認・修正' }));
    expect(screen.getByText(/原本PDFはこの画面に保存されていません/)).toBeTruthy();
  });
});
