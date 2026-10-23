import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ShiftMonthActions } from './ShiftMonthActions';
const meta = { title: 'Shifts/Manage/MonthActions', component: ShiftMonthActions,
  parameters: { layout: 'fullscreen' },
  args: { targetMonth: '2026-11', onMonthChange: fn(), canGenerate: true, canClear: true,
    generating: false, patternCount: 1, onPreview: fn(), onClear: fn() },
} satisfies Meta<typeof ShiftMonthActions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Normal: Story = { play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: '一括自動展開する' })); await expect(args.onPreview).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: '一括消去する' })); await expect(args.onClear).toHaveBeenCalledOnce();
} };
export const Empty: Story = { args: { patternCount: 0 }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole('button', { name: '一括自動展開する' })).toBeDisabled();
  await expect(canvas.getByRole('button', { name: '一括消去する' })).toBeDisabled();
} };
export const Processing: Story = { args: { generating: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole('progressbar')).toBeVisible();
  await expect(canvas.getByRole('button', { name: '一括自動展開する' })).toBeDisabled();
  await expect(canvas.getByRole('button', { name: '一括消去する' })).toBeDisabled();
} };
export const ReadOnly: Story = { args: { canGenerate: false, canClear: false }, play: Empty.play };
