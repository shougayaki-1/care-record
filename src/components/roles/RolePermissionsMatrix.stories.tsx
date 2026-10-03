import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import RolePermissionsMatrix from './RolePermissionsMatrix';
import { EMPTY_PERMISSIONS } from '@/utils/permissions';

const meta = {
  title: 'Roles/RolePermissionsMatrix',
  component: RolePermissionsMatrix,
  args: { value: EMPTY_PERMISSIONS, onChange: fn(), isOwner: false },
} satisfies Meta<typeof RolePermissionsMatrix>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NonOwner: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    for (const name of ['アカウント管理', 'ロール管理', '事業所削除', 'オーナー移譲']) {
      const checkbox = canvas.getByRole('checkbox', { name });
      await expect(checkbox).toBeDisabled();
      await expect(checkbox).toHaveAccessibleDescription(/オーナーのみ変更できます/);
      await userEvent.click(checkbox, { pointerEventsCheck: 0 });
    }
    await expect(args.onChange).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('checkbox', { name: 'スタッフ管理' }));
    await expect(args.onChange).toHaveBeenCalled();
  },
};
export const Owner: Story = {
  args: { isOwner: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('checkbox', { name: 'ロール管理' })).toBeEnabled();
  },
};
export const Disabled: Story = { args: { isOwner: true, disabled: true } };
