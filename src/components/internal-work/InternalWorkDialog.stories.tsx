import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test';
import { saveInternalWork } from '@/app/actions/internalWork';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';
import InternalWorkDialog from './InternalWorkDialog';

const meta = {
  title: 'Record/InternalWorkDialog', component: InternalWorkDialog,
  parameters: { layout: 'fullscreen' },
  args: { open: true, organizationId: 'org-1', staffOptions: [{ id: 'staff-1', name: '担当スタッフ' }], onClose: fn(), onSaved: fn() },
  decorators: [(Story) => <ToastProvider><ConfirmProvider><Story /></ConfirmProvider></ToastProvider>],
  beforeEach: () => { mocked(saveInternalWork).mockResolvedValue({ success: true, id: 'work-1' }); },
} satisfies Meta<typeof InternalWorkDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Save: Story = {
  play: async ({ args }) => {
    const dialog = within(document.body).getByRole('dialog', { name: '内勤を記録' });
    const form = within(dialog);
    const actions = form.getByRole('group', { name: '記録操作' });
    await expect(actions.closest('.MuiDialogActions-root')).toBeNull();
    await userEvent.click(form.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(args.onSaved).toHaveBeenCalled());
    await expect(saveInternalWork).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'staff-1', title: '会議', workHours: 1 }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
export const Validation: Story = {
  play: async () => {
    const form = within(within(document.body).getByRole('dialog', { name: '内勤を記録' }));
    await userEvent.clear(form.getByRole('textbox', { name: '件名' }));
    await userEvent.click(form.getByRole('button', { name: '保存' }));
    await expect(form.getByText('件名を1〜100文字で入力してください')).toBeVisible();
    await expect(form.getByRole('textbox', { name: '件名' })).toHaveAttribute('aria-invalid', 'true');
  },
};
export const CancelEdited: Story = {
  play: async ({ args }) => {
    const body = within(document.body);
    const dialog = body.getByRole('dialog', { name: '内勤を記録' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'メモ' }), '未保存のメモ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    const confirmation = body.getByRole('dialog', { name: '保存されていない変更があります' });
    await waitFor(() => expect(confirmation).toBeVisible());
    await userEvent.click(within(confirmation).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(confirmation).not.toBeVisible());
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'メモ' })).toHaveValue('未保存のメモ'));
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};
