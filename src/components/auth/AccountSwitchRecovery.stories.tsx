import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { AccountSwitchRecovery } from './AccountSwitchRecovery';

const meta = {
  title: 'Auth/AccountSwitchRecovery',
  component: AccountSwitchRecovery,
  tags: ['autodocs'],
} satisfies Meta<typeof AccountSwitchRecovery>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithEmail: Story = {
  args: { email: 'user@example.com' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('現在ログイン中: user@example.com')).toBeVisible();
    await expect(canvas.getByRole('button', { name: '別のアカウントでログインする' }).closest('form'))
      .toHaveAttribute('action', '/api/auth/recover');
  },
};

export const WithoutEmail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/現在ログイン中:/)).toBeNull();
    await expect(canvas.getByRole('button', { name: '別のアカウントでログインする' })).toBeVisible();
  },
};

export const ScreenWidths: Story = {
  args: { email: 'a-long-current-account-email-address-to-check-wrapping@example.com' },
  render: args => (
    <>
      {[240, 320, 375, 960].map(width => (
        <div key={width} data-testid={`width-${width}`} style={{ width, maxWidth: '100%', textAlign: 'center' }}>
          <AccountSwitchRecovery {...args} />
        </div>
      ))}
    </>
  ),
  play: async ({ canvasElement, args }) => {
    for (const width of [240, 320, 375, 960]) {
      const surface = within(canvasElement).getByTestId(`width-${width}`);
      await expect(within(surface).getByText(`現在ログイン中: ${args.email}`)).toBeVisible();
      await expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth);
    }
  },
};
