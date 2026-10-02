import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn, expect, userEvent, within } from 'storybook/test';
import { ReauthDialog } from './ReauthDialog';

const meta = {
  title: 'Auth/ReauthDialog', component: ReauthDialog, tags: ['autodocs'],
  args: { methods: ['password'], method: 'password', loading: false, error: null,
    onMethodChange: fn(), onSubmit: fn().mockResolvedValue(undefined), onCancel: fn() },
} satisfies Meta<typeof ReauthDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Password: Story = {
  play: async ({ args }) => {
    const body = within(document.body);
    const field = body.getByLabelText('現在のパスワード');
    await expect(field).toHaveAttribute('autocomplete', 'current-password');
    await userEvent.type(field, 'storybook-password');
    await userEvent.click(body.getByRole('button', { name: '本人確認する' }));
    await expect(args.onSubmit).toHaveBeenCalledWith('storybook-password');
    await expect(field).toHaveValue('');
  },
};
export const MultipleMethods: Story = { args: { methods: ['password', 'google', 'azure'], method: 'google' } };
export const Microsoft: Story = { args: { methods: ['azure'], method: 'azure' } };
export const Retry: Story = { args: { error: '本人確認に失敗しました。もう一度お試しください。' } };
export const Loading: Story = { args: { loading: true }, play: async ({ args }) => {
  await userEvent.click(within(document.body).getByRole('button', { name: 'キャンセル' }));
  await expect(args.onCancel).toHaveBeenCalled();
} };
