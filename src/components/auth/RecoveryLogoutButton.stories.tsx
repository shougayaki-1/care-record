import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RecoveryLogoutButton } from './RecoveryLogoutButton';

const meta = {
  title: 'Auth/RecoveryLogoutButton',
  component: RecoveryLogoutButton,
  tags: ['autodocs'],
} satisfies Meta<typeof RecoveryLogoutButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SwitchAccount: Story = { args: { label: '別のアカウントでログインする' } };
export const NativePost: Story = { args: { attemptClientLogout: false } };
