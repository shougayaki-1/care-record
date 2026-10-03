import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within, waitFor } from 'storybook/test';
import { Stack } from '@mui/material';
import { AppButton } from './AppButton';
import { ToastProvider, useToast } from './ToastProvider';

const ToastButtons = () => {
  const { showToast, dismissToast } = useToast();
  return <Stack direction="row" spacing={1}><AppButton onClick={() => showToast('保存しました')}>成功</AppButton><AppButton intent="danger" onClick={() => showToast('保存に失敗しました', 'error')}>エラー</AppButton><AppButton onClick={dismissToast}>通知を消す</AppButton></Stack>;
};
const ToastShowcase = () => <ToastProvider><ToastButtons /></ToastProvider>;
const meta = { title: 'UI/Toast', component: ToastShowcase, tags: ['autodocs'] } satisfies Meta<typeof ToastShowcase>;
export default meta;
export const Notifications: StoryObj<typeof meta> = {};


export const ReplaceAndDismiss: StoryObj<typeof meta> = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole('button', { name: '成功' }));
  await waitFor(() => expect(body.getByText('保存しました')).toBeVisible());
  await userEvent.click(canvas.getByRole('button', { name: 'エラー' }));
  await waitFor(() => expect(body.getByText('保存に失敗しました')).toBeVisible());
  await expect(body.queryByText('保存しました')).not.toBeInTheDocument();
  await userEvent.click(canvas.getByRole('button', { name: '通知を消す' }));
  await waitFor(() => expect(body.queryByText('保存に失敗しました')).not.toBeInTheDocument());
} };
