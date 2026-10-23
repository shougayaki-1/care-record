import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ShiftFetchStatus } from '../ShiftFetchStatus';
import { ShiftPatternTable } from './ShiftPatternTable';
const meta = {
  title: 'Shifts/Manage/PatternTable', component: ShiftPatternTable,
  args: { patterns: [{ id: 'pattern', client_id: 'client', title: '訪問', start_time: '09:00:00', end_time: '10:00:00',
    rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', clients: { name: '利用者' }, shift_pattern_staffs: [] }],
    mastersReady: true, canEditShift: true, canDeleteShift: true, onEdit: fn(), onDelete: fn() },
} satisfies Meta<typeof ShiftPatternTable>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { args: { patterns: [] }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByText('ひな形が登録されていません')).toBeVisible();
} };
export const Normal: Story = { play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText('2週間に1回 月, 水')).toBeVisible();
  await expect(canvas.getByText('未割り当て')).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: 'ひな形を編集' }));
  await expect(args.onEdit).toHaveBeenCalledWith(args.patterns[0]);
  await userEvent.click(canvas.getByRole('button', { name: 'ひな形を削除' }));
  await expect(args.onDelete).toHaveBeenCalledWith('pattern');
} };
export const ReadOnly: Story = { args: { canEditShift: false, canDeleteShift: false }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument();
} };
export const MasterFailure: Story = { args: { mastersReady: false }, render: args => <>
  <ShiftFetchStatus masterStatus="error" countStatus="success" showCount={false} onRetryMaster={fn()} onRetryCount={fn()} />
  <ShiftPatternTable {...args} />
</>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(/シフトの閲覧はできます/)).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'ひな形を編集' })).toBeDisabled();
  await expect(canvas.getByRole('button', { name: 'ひな形を削除' })).toBeEnabled();
} };
