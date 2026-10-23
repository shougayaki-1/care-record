import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { ShiftMonthClearDialog, ShiftMonthPreviewDialog } from './ShiftMonthDialogs';
const meta = { title: 'Shifts/Manage/MonthPreview', component: ShiftMonthPreviewDialog,
  args: { open: true, targetMonth: '2026-11', mastersReady: true, onClose: fn(), onConfirm: fn(),
    previewDetails: { total: 4, details: [{ title: '夜勤', count: 4, isOvernight: true }] } },
} satisfies Meta<typeof ShiftMonthPreviewDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Normal: Story = { play: async ({ args }) => {
  const dialog = within(await within(document.body).findByRole('dialog'));
  await waitFor(() => expect(dialog.getByText(/展開予定の総シフト数： 4 件/)).toBeVisible());
  await expect(dialog.getByText('日またぎ夜勤')).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: '確定してカレンダーに展開' })); await expect(args.onConfirm).toHaveBeenCalledOnce();
} };
export const CancelPreview: Story = { play: async ({ args }) => {
  const dialog = within(await within(document.body).findByRole('dialog'));
  await userEvent.click(dialog.getByRole('button', { name: '閉じる' }));
  await expect(args.onClose).toHaveBeenCalledOnce(); await expect(args.onConfirm).not.toHaveBeenCalled();
} };
export const Empty: Story = { args: { previewDetails: { total: 0, details: [] } }, play: async () => {
  const dialog = within(await within(document.body).findByRole('dialog'));
  await waitFor(() => expect(dialog.getByText(/総シフト数： 0 件/)).toBeVisible());
} };
export const MasterUnavailable: Story = { args: { mastersReady: false }, play: async () => {
  await expect(within(await within(document.body).findByRole('dialog')).getByRole('button', { name: '確定してカレンダーに展開' })).toBeDisabled();
} };
export const ClearMonth: Story = { render: args => <ShiftMonthClearDialog open targetMonth={args.targetMonth} clearMode="unmodified"
  onModeChange={fn()} onClose={args.onClose} onConfirm={args.onConfirm} />,
  play: async ({ args }) => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await expect(dialog.getByRole('radio', { name: /未変更のシフトだけ消す/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /全部一括消去する/ })).not.toBeChecked();
    await userEvent.click(dialog.getByRole('button', { name: 'キャンセル' }));
    await expect(args.onClose).toHaveBeenCalledOnce(); await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};
