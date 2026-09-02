// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormItem } from '@/constants/formTemplates';
import { FormBuilderTab } from './FormBuilderTab';

afterEach(cleanup);

const baseProps = {
  onOpenCopy: vi.fn(),
  onRemoveField: vi.fn(),
  onMoveField: vi.fn(),
  getOptions: (options?: string) => (options ? options.split(',') : []),
  onUpdateOption: vi.fn(),
  onAddOption: vi.fn(),
  onRemoveOption: vi.fn(),
  onMoveOption: vi.fn(),
};

const items: FormItem[] = [
  { id: 'a', label: '項目A', type: 'checkbox', required: false },
  { id: 'b', label: '項目B', type: 'checkbox', required: false, hasDetail: true, detailMode: 'conditional' },
  { id: 'c', label: '項目C', type: 'checkbox', required: false },
];

describe('FormBuilderTab', () => {
  it('hides display-condition and detailLabel controls when hasDetail is OFF', () => {
    const offOnly: FormItem[] = [{ id: 'a', label: '項目A', type: 'checkbox', required: false }];
    render(<FormBuilderTab {...baseProps} formItems={offOnly} onAddField={vi.fn()} onUpdateField={vi.fn()} />);
    expect(screen.queryByText('表示条件')).toBeNull();
    expect(screen.queryByLabelText('詳細欄のラベル')).toBeNull();
  });

  it('shows display-condition and detailLabel controls when hasDetail is ON', () => {
    render(<FormBuilderTab {...baseProps} formItems={items} onAddField={vi.fn()} onUpdateField={vi.fn()} />);
    expect(screen.getByText('表示条件')).toBeTruthy();
    expect(screen.getByLabelText('詳細欄のラベル')).toBeTruthy();
    expect((screen.getByLabelText('回答したときに表示') as HTMLInputElement).checked).toBe(true);
  });

  it('switching to always mode calls onUpdateField with detailMode=always', async () => {
    const onUpdateField = vi.fn();
    render(<FormBuilderTab {...baseProps} formItems={items} onAddField={vi.fn()} onUpdateField={onUpdateField} />);
    await userEvent.click(screen.getByLabelText('常に表示'));
    expect(onUpdateField).toHaveBeenCalledWith(1, 'detailMode', 'always');
  });

  it('insert-here button passes the correct insertIndex for both the leading and a between-item position', async () => {
    const onAddField = vi.fn();
    render(<FormBuilderTab {...baseProps} formItems={items} onAddField={onAddField} onUpdateField={vi.fn()} />);
    const buttons = screen.getAllByRole('button', { name: /項目を追加|ここに項目を追加/ });
    // Button order: [before A], [between A/B], [between B/C], [after C], [trailing "項目を追加する"].
    // First "ここに項目を追加" button = insert before index 0.
    await userEvent.click(buttons[0]);
    expect(onAddField).toHaveBeenCalledWith(0);

    // Third button (index 2 in `buttons`) sits between item B and item C (given items A, B, C)
    // and must request insertion at index 2.
    await userEvent.click(buttons[2]);
    expect(onAddField).toHaveBeenCalledWith(2);
  });

  it('preview button shows preview UI when provided', async () => {
    const onOpenPreview = vi.fn();
    render(<FormBuilderTab {...baseProps} formItems={items} onAddField={vi.fn()} onUpdateField={vi.fn()} onOpenPreview={onOpenPreview} />);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));
    expect(onOpenPreview).toHaveBeenCalled();
  });

  it('enables hasDetail toggle for non-selection types too (e.g. text)', () => {
    const textItems: FormItem[] = [{ id: 't', label: '特記', type: 'text', required: false }];
    render(<FormBuilderTab {...baseProps} formItems={textItems} onAddField={vi.fn()} onUpdateField={vi.fn()} />);
    expect(screen.getByText('詳細入力を許可')).toBeTruthy();
  });

  it('does not show hasDetail toggle for section items', () => {
    const sectionItems: FormItem[] = [{ id: 's', label: '見出し', type: 'section', required: false }];
    render(<FormBuilderTab {...baseProps} formItems={sectionItems} onAddField={vi.fn()} onUpdateField={vi.fn()} />);
    expect(screen.queryByText('詳細入力を許可')).toBeNull();
  });
});

describe('FormBuilderTab within FormBuilderTab test helper', () => {
  it('exposes the trailing add-field button', () => {
    render(<FormBuilderTab {...baseProps} formItems={[]} onAddField={vi.fn()} onUpdateField={vi.fn()} />);
    expect(screen.getByRole('button', { name: '項目を追加する' })).toBeTruthy();
  });
});
