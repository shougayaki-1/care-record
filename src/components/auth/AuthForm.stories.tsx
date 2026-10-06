import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, mocked, userEvent, waitFor, within } from 'storybook/test';
import { registerWithPassword } from '@/app/actions/auth';
import { AuthForm } from './AuthForm';

const meta = {
  title: 'Auth/AuthForm',
  component: AuthForm,
  tags: ['autodocs'],
  decorators: [(Story) => <div style={{ width: 360, maxWidth: '100%' }}><Story /></div>],
} satisfies Meta<typeof AuthForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Login: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'ログイン' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByLabelText(/^パスワード/)).toHaveAttribute('autocomplete', 'current-password');
    await userEvent.type(canvas.getByLabelText(/^パスワード/), 'synthetic-input');
    await userEvent.click(canvas.getByRole('tab', { name: '新規登録' }));
    await expect(canvas.getByLabelText(/^パスワード/)).toHaveValue('');
    await expect(canvas.getByLabelText(/^パスワード/)).toHaveAttribute('autocomplete', 'new-password');
  },
};

export const Register: Story = {
  parameters: { nextjs: { navigation: { pathname: '/login', query: { register: '1', next: '/setup' } } } },
  beforeEach: () => {
    mocked(registerWithPassword).mockResolvedValue({ ok: true, signedIn: false });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: '新規登録' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'アカウントを作成' })).toBeVisible());
    await expect(canvas.getByLabelText(/^メールアドレス/)).toHaveAttribute('autocomplete', 'email');
    await expect(canvas.getByLabelText(/^パスワード/)).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(canvas.getByLabelText(/^メールアドレス/), 'synthetic@example.invalid');
    await userEvent.type(canvas.getByLabelText(/^パスワード/), 'Synthetic!123');
    await userEvent.click(canvas.getByRole('button', { name: 'アカウントを作成' }));
    await expect(await canvas.findByText('確認メールを送信しました。メール内のリンクから登録を完了してください。')).toBeVisible();
  },
};
