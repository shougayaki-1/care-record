import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ShiftSyncProgress } from './ShiftSyncProgress';
const meta = { title: 'Shifts/Manage/SyncProgress', component: ShiftSyncProgress,
  args: { syncProgress: { total: 4, current: 2, currentName: '2 / 4 件 処理済み' } },
} satisfies Meta<typeof ShiftSyncProgress>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Multiple: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await expect(canvas.getByText('2 / 4 件完了')).toBeVisible();
} };
export const Single: Story = { args: { syncProgress: { total: 1, current: 0, currentName: 'Googleカレンダーの予定を更新中...' } }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
} };
export const Hidden: Story = { args: { syncProgress: null }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).queryByRole('progressbar')).not.toBeInTheDocument();
} };
