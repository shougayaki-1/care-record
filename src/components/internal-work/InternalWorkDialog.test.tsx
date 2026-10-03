// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ui/mui';
import theme from '@/theme';
import InternalWorkDialog from './InternalWorkDialog';

const { save, confirm, toast } = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn(), toast: vi.fn() }));
vi.mock('@/app/actions/internalWork', () => ({ saveInternalWork: save }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: toast }) }));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue({ success: true, id: 'work-1' }); confirm.mockResolvedValue(false); });
function open(onClose = vi.fn(), onSaved = vi.fn()) {
  render(<ThemeProvider theme={theme}><InternalWorkDialog open organizationId="org-1" staffOptions={[{ id: 'staff-1', name: 'テスト担当' }]} onClose={onClose} onSaved={onSaved} /></ThemeProvider>);
  return { onClose, onSaved, dialog: screen.getByRole('dialog', { name: '内勤を記録' }) };
}
describe('InternalWorkDialog record UI', () => {
  it('uses the record header and labelled inputs, with the existing save payload and callback order', async () => {
    const { onClose, onSaved, dialog } = open();
    const actions = within(dialog).getByRole('group', { name: '記録操作' });
    expect(within(actions).getByRole('button', { name: '保存' })).toBeTruthy();
    expect(within(dialog).getByLabelText('開始日時', { exact: false })).toBeTruthy();
    expect(within(dialog).getByLabelText('終了日時', { exact: false })).toBeTruthy();
    fireEvent.click(within(actions).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1', staffId: 'staff-1', title: '会議', workType: 'meeting', workHours: 1, note: '' }));
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(onSaved.mock.invocationCallOrder[0]);
    expect(onSaved.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });
  it('shows the existing title and hours constraints by their inputs before saving', () => {
    const { dialog } = open();
    fireEvent.change(within(dialog).getByLabelText('件名', { exact: false }), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText('内勤時間', { exact: false }), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(save).not.toHaveBeenCalled();
    expect(within(dialog).getByText('件名を1〜100文字で入力してください')).toBeTruthy();
    expect(within(dialog).getByLabelText('件名', { exact: false }).getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByText('内勤時間を0より大きく24以下で入力してください')).toBeTruthy();
  });
  it('keeps edited input when cancellation of an unsaved close is declined', async () => {
    const { dialog, onClose } = open();
    fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: '未保存のメモ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByDisplayValue('未保存のメモ')).toBeTruthy();
  });
  it('closes unchanged input directly and edited input after confirmation', async () => {
    const { dialog, onClose } = open();
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: '編集' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });
  it('uses the shared busy button and disables controls while the existing save is pending', async () => {
    let finish!: () => void;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const { dialog } = open();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(within(dialog).getByRole('button', { name: /保存/ }).getAttribute('aria-busy')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveProperty('disabled', true);
    expect(within(dialog).getByLabelText('件名', { exact: false })).toHaveProperty('disabled', true);
    finish();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '保存' })).toHaveProperty('disabled', false));
  });
  it('retains every input after failure and resets it only after successful retry', async () => {
    save.mockRejectedValueOnce(new Error('offline'));
    const { dialog, onClose } = open();
    fireEvent.change(within(dialog).getByLabelText('件名', { exact: false }), { target: { value: '研修メモ' } });
    fireEvent.change(within(dialog).getByLabelText('内勤時間', { exact: false }), { target: { value: '2.5' } });
    fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: '再試行する入力' } });
    const before = within(dialog).getByLabelText('開始日時', { exact: false }).getAttribute('value');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('入力内容は保持'), 'error'));
    expect(within(dialog).getByRole('alert').textContent).toContain('入力内容は保持');
    expect(onClose).not.toHaveBeenCalled(); expect(within(dialog).getByDisplayValue('研修メモ')).toBeTruthy();
    expect(within(dialog).getByDisplayValue('2.5')).toBeTruthy(); expect(within(dialog).getByDisplayValue('再試行する入力')).toBeTruthy();
    expect(within(dialog).getByLabelText('開始日時', { exact: false }).getAttribute('value')).toBe(before);
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(2); expect(within(dialog).getByDisplayValue('会議')).toBeTruthy();
    expect(within(dialog).getByLabelText('メモ')).toHaveProperty('value', '');
    expect(within(dialog).getByLabelText('内勤時間', { exact: false })).toHaveProperty('value', '1');
  });
  it('does not save twice while the first request is unresolved', async () => {
    let finish!: () => void; save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const { dialog, onClose } = open(); const button = within(dialog).getByRole('button', { name: '保存' });
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(save).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled();
    finish(); await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

});
