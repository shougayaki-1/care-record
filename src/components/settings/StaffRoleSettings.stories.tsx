import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, mocked, within } from 'storybook/test';
import { getStaffRoles } from '@/app/actions/staffRoles';
import StaffRoleSettings from './StaffRoleSettings';

const meta = {
  title: 'Settings/StaffRoleSettings', component: StaffRoleSettings,
  args: { orgId: 'fixture-org' },
  beforeEach: () => { mocked(getStaffRoles).mockResolvedValue({ ok: true, data: [] }); },
} satisfies Meta<typeof StaffRoleSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SessionExpired: Story = {
  beforeEach: () => { mocked(getStaffRoles).mockResolvedValue({ ok: false, error: { code: 'SESSION_EXPIRED', message: 'セッションの有効期限が切れています' } }); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('セッションの有効期限が切れています');
    await expect(canvas.queryByText('設定なし')).not.toBeInTheDocument();
    const recovery = canvas.getByRole('button', { name: 'ログアウトしてやり直す' });
    await expect(recovery.closest('form')).toHaveAttribute('method', 'post');
    await expect(recovery.closest('form')).toHaveAttribute('action', '/api/auth/recover');
  },
};
