import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test';
import { getShiftSegments } from '@/app/actions/shiftSegments';
import { getServiceTypes } from '@/app/actions/serviceTypes';
import { getStaffRoles } from '@/app/actions/staffRoles';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { ShiftFormModal } from './ShiftFormModal';

const meta = {
  title: 'Shifts/ShiftFormModal', component: ShiftFormModal,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <ToastProvider><ConfirmProvider><Story /></ConfirmProvider></ToastProvider>],
  args: { open: true, organizationId: 'fixture-org', clients: [{ id: 'client', name: '利用者' }], staffs: [],
    onSave: fn(), onDelete: fn().mockResolvedValue(undefined), onClose: fn(),
    initialData: { id: 'shift', client_id: 'client', title: 'シフト', start_at: '2026-10-06T09:00:00+09:00',
      end_at: '2026-10-06T10:00:00+09:00', status: 'published', cancel_reason: null, shift_staffs: [] },
  },
  beforeEach: () => {
    mocked(getShiftSegments).mockResolvedValue([]);
    mocked(getServiceTypes).mockResolvedValue([]);
    mocked(getStaffRoles).mockResolvedValue([]);
  },
} satisfies Meta<typeof ShiftFormModal>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openDeleteConfirmation() {
  const body = within(document.body);
  const form = within(body.getByRole('dialog', { name: '単発シフトの編集・詳細' }));
  await userEvent.click(form.getByRole('button', { name: 'この予定を削除' }));
  const dialog = await body.findByRole('dialog', { name: 'シフトの削除' });
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}
export const Delete: Story = {
  play: async ({ args }) => {
    const dialog = await openDeleteConfirmation();
    await expect(within(dialog).getByText(/データは保持方針に従って保存/)).toBeVisible();
    await expect(within(dialog).getByText(/連携エラー時は同期修復が必要/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: '削除する' }));
    await waitFor(() => expect(args.onDelete).toHaveBeenCalledWith('shift'));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
export const CancelDeletion: Story = {
  play: async ({ args }) => {
    const dialog = await openDeleteConfirmation();
    await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(() => expect(dialog).not.toBeVisible());
    await expect(args.onDelete).not.toHaveBeenCalled(); await expect(args.onClose).not.toHaveBeenCalled();
  },
};
export const UnapprovedRetentionPolicy: Story = {
  render: args => <ShiftFormModal {...args} onDelete={async () => {
    throw new Error('シフトの保持方針が未承認のため削除できません。事業所のオーナーに保持方針の承認を依頼してください。');
  }} />,
  play: async ({ args }) => {
    const dialog = await openDeleteConfirmation();
    await userEvent.click(within(dialog).getByRole('button', { name: '削除する' }));
    const message = await within(document.body).findByText(/オーナーに保持方針の承認を依頼/);
    await waitFor(() => expect(message).toBeVisible());
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};
