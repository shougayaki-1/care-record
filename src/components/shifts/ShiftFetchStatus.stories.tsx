import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ShiftFetchStatus } from './ShiftFetchStatus';

const meta = {
    title: 'Shifts/ShiftFetchStatus', component: ShiftFetchStatus,
    args: { masterStatus: 'success', countStatus: 'success', showCount: true, onRetryMaster: fn(), onRetryCount: fn() },
} satisfies Meta<typeof ShiftFetchStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
    args: { masterStatus: 'loading', countStatus: 'loading' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText(/利用者・スタッフ情報を取得中/)).toBeVisible();
        await expect(canvas.getByText('未同期件数を確認中です。')).toBeVisible();
        await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
    },
};
export const Failed: Story = {
    args: { masterStatus: 'error', countStatus: 'error' },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement);
        await expect(canvas.getByText(/シフトの閲覧はできます/)).toBeVisible();
        await expect(canvas.getByText(/同期状態は未確認/)).toBeVisible();
        await userEvent.click(canvas.getByRole('button', { name: 'マスタを再試行' }));
        await userEvent.click(canvas.getByRole('button', { name: '未同期件数を再試行' }));
        await expect(args.onRetryMaster).toHaveBeenCalledTimes(1);
        await expect(args.onRetryCount).toHaveBeenCalledTimes(1);
    },
};
export const Success: Story = {
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryByRole('alert')).not.toBeInTheDocument();
    },
};
