import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Stack } from '@mui/material';
import { AppButton } from './AppButton';
import { ToastProvider, useToast } from './ToastProvider';

const ToastButtons = () => {
  const { showToast } = useToast();
  return <Stack direction="row" spacing={1}><AppButton onClick={() => showToast('保存しました')}>成功</AppButton><AppButton intent="danger" onClick={() => showToast('保存に失敗しました', 'error')}>エラー</AppButton></Stack>;
};
const ToastShowcase = () => <ToastProvider><ToastButtons /></ToastProvider>;
const meta = { title: 'UI/Toast', component: ToastShowcase, tags: ['autodocs'] } satisfies Meta<typeof ToastShowcase>;
export default meta;
export const Notifications: StoryObj<typeof meta> = {};

