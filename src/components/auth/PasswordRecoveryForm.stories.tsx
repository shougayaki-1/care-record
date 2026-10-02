import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { PasswordRecoveryForm } from './PasswordRecoveryForm';

const meta = { title: 'Auth/PasswordRecoveryForm', component: PasswordRecoveryForm,
  tags: ['autodocs'], args: { mode: 'request' } } satisfies Meta<typeof PasswordRecoveryForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Request: Story = { play: async ({ canvasElement }) => {
  await expect(within(canvasElement).getByLabelText('メールアドレス', { exact: false })).toHaveAttribute('autocomplete', 'email');
} };
export const Reset: Story = { args: { mode: 'reset' } };
export const InvalidLink: Story = { args: { mode: 'reset', validLink: false } };
