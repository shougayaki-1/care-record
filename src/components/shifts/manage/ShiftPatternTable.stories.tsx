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

const pattern = (id: string, client: string, rrule: string, start: string, staff: { staff_id: string; staffs: { name: string } }[] = []) => ({
  id, client_id: client, title: '訪問', start_time: start, end_time: '18:00:00', rrule,
  clients: { name: client }, shift_pattern_staffs: staff,
});
const helperA = { staff_id: 'a', staffs: { name: 'ヘルパーA' } };
const helperB = { staff_id: 'b', staffs: { name: 'ヘルパーB' } };
export const SortingAndGrouping: Story = {
  args: { patterns: [
    pattern('none', '利用者D', 'FREQ=WEEKLY', '08:00:00'),
    pattern('tue', '利用者C', 'FREQ=WEEKLY;BYDAY=TU', '08:00:00', [helperA]),
    pattern('multi', '利用者B', 'FREQ=WEEKLY;BYDAY=WE,MO', '10:00:00', [helperA, helperB]),
    pattern('early', '利用者A', 'FREQ=WEEKLY;BYDAY=MO', '09:00:00'),
  ] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const rows = () => canvas.getAllByRole('row').slice(1).map(row => row.textContent ?? '');
    await expect(canvas.getByRole('radio', { name: 'すべて混合' })).toBeChecked();
    await expect(rows().map(row => row.match(/利用者[A-D]/)?.[0])).toEqual(['利用者A', '利用者B', '利用者C', '利用者D']);
    await expect(canvas.getByText('毎週 水, 月')).toBeVisible();
    await userEvent.click(canvas.getByRole('radio', { name: 'ヘルパーごと' }));
    await expect(canvas.getAllByText('利用者B')).toHaveLength(2);
    await expect(rows().filter(row => row.includes('利用者B') || row.includes('利用者C')).map(row => row.match(/利用者[B-C]/)?.[0])).toEqual(['利用者B', '利用者C', '利用者B']);
    await expect(canvas.getAllByText('未割り当て').length).toBeGreaterThan(0);
    const multiRows = canvas.getAllByRole('row').filter(row => row.textContent?.includes('利用者B'));
    await userEvent.click(within(multiRows[1]).getByRole('button', { name: 'ひな形を編集' }));
    await expect(args.onEdit).toHaveBeenCalledWith(args.patterns[2]);
    await userEvent.click(within(multiRows[1]).getByRole('button', { name: 'ひな形を削除' }));
    await expect(args.onDelete).toHaveBeenCalledWith('multi');
    await userEvent.click(canvas.getByRole('radio', { name: '利用者ごと' }));
    await expect(canvas.getAllByText('利用者B')).toHaveLength(2);
    await expect(canvas.getAllByRole('row').filter(row => row.textContent?.includes('利用者B'))).toHaveLength(2);
  },
};
