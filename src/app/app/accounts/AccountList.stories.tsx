import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AccountList } from './AccountList';

const meta = {
  title: 'Accounts/AccountList', component: AccountList,
  args: {
    isMobile: false, currentUserId: 'owner', isFetching: false, canManageAccounts: true, isOwner: true,
    accountList: [
      { id: 'owner', name: '現在のオーナー', role: 'owner', roles: [], status: 'active' },
      { id: 'member', name: 'メンバー', role: 'member', roles: [{ id: 'care', name: '介護職員', color: null }], status: 'active' },
      { id: 'invite', name: '招待した職員', role: 'member', roles: [], status: 'invited', invitation_code: 'storybook-code', staffName: '職員名簿の名前' },
    ],
    onEditRoles: fn(), onRemove: fn(), onAddOwner: fn(), onCopyInvitation: fn(),
  },
} satisfies Meta<typeof AccountList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Accounts: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'メンバーの操作' }));
    await userEvent.click(within(document.body).getByRole('menuitem', { name: 'オーナーに追加' }));
    await expect(args.onAddOwner).toHaveBeenCalledWith(args.accountList[1]);
  },
};
export const Mobile: Story = { args: { isMobile: true }, play: async ({ canvasElement }) => {
  await expect(within(canvasElement).queryByRole('table')).toBeNull();
  await expect(within(canvasElement).getByText('名簿: 職員名簿の名前')).toBeVisible();
} };
export const Loading: Story = { args: { isFetching: true } };
export const Empty: Story = { args: { accountList: [] } };
export const Member: Story = {
  args: { isOwner: false, currentUserId: 'member' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'メンバーの操作' }));
    await expect(within(document.body).queryByRole('menuitem', { name: 'オーナーに追加' })).toBeNull();
    await userEvent.keyboard('{Escape}');
  },
};
export const Invitation: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '招待した職員の操作' }));
    await userEvent.click(within(document.body).getByRole('menuitem', { name: '招待リンクを再コピー' }));
    await expect(args.onCopyInvitation).toHaveBeenCalledWith('storybook-code');
  },
};
