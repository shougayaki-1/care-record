import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ShiftManageFilters } from './ShiftManageFilters';
const meta = { title: 'Shifts/Manage/Filters', component: ShiftManageFilters,
  args: { activeTab: 'byStaff', selectedStaffId: 'all', selectedClientId: 'all',
    staffs: [{ id: 'staff', name: 'スタッフ' }], clients: [{ id: 'client', name: '利用者' }], onStaffChange: fn(), onClientChange: fn() },
} satisfies Meta<typeof ShiftManageFilters>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Staff: Story = { play: async ({ canvasElement, args }) => {
  await userEvent.click(within(canvasElement).getByRole('combobox', { name: 'スタッフを選択' }));
  await userEvent.click(await within(document.body).findByRole('option', { name: 'スタッフ' }));
  await expect(args.onStaffChange).toHaveBeenCalledWith('staff');
} };
export const Client: Story = { args: { activeTab: 'byClient' }, play: async ({ canvasElement, args }) => {
  await userEvent.click(within(canvasElement).getByRole('combobox', { name: '利用者を選択' }));
  await userEvent.click(await within(document.body).findByRole('option', { name: '利用者' }));
  await expect(args.onClientChange).toHaveBeenCalledWith('client');
} };
export const Empty: Story = { args: { staffs: [] }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByRole('combobox')).toHaveTextContent('全員を表示');
} };
