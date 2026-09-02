// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { FormItem } from '@/constants/formTemplates';
import { FormPreviewDialog } from './FormPreviewDialog';

afterEach(cleanup);

describe('FormPreviewDialog', () => {
  it('renders the currently-edited (unsaved) formItems, not a persisted schema', () => {
    const formItems: FormItem[] = [
      { id: 'a', label: 'まだ保存していない質問', type: 'checkbox', required: false },
    ];
    render(<FormPreviewDialog open onClose={() => {}} formItems={formItems} />);
    expect(screen.getByText('まだ保存していない質問')).toBeTruthy();
  });

  it('reflects live edits when reopened with a new formItems array', () => {
    const initial: FormItem[] = [{ id: 'a', label: '質問A', type: 'checkbox', required: false }];
    const { rerender } = render(<FormPreviewDialog open onClose={() => {}} formItems={initial} />);
    expect(screen.getByText('質問A')).toBeTruthy();

    const edited: FormItem[] = [{ id: 'a', label: '質問A（編集後）', type: 'checkbox', required: false }];
    rerender(<FormPreviewDialog open onClose={() => {}} formItems={edited} />);
    expect(screen.getByText('質問A（編集後）')).toBeTruthy();
  });

  it('uses local preview state to reveal conditional detail input', async () => {
    const formItems: FormItem[] = [
      { id: 'a', label: 'チェック項目', type: 'checkbox', required: false, hasDetail: true, detailMode: 'conditional' },
    ];
    render(<FormPreviewDialog open onClose={() => {}} formItems={formItems} />);
    await userEvent.click(screen.getByLabelText('チェック項目'));
    // Detail field should now appear, driven purely by local state.
    expect(screen.getByLabelText('詳細・補足')).toBeTruthy();
  });

  it('shows a note that this is only the configurable questions preview', () => {
    const formItems: FormItem[] = [];
    render(<FormPreviewDialog open onClose={() => {}} formItems={formItems} />);
    expect(screen.getByText(/設定可能な設問部分のプレビュー/)).toBeTruthy();
  });
});
