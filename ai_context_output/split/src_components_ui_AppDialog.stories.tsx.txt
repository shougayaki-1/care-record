import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Typography } from '@mui/material';
import { useState } from 'react';
import { AppButton } from './AppButton';
import { AppDialog } from './AppDialog';

const DialogShowcase = () => {
  const [open, setOpen] = useState(true);
  return <><AppButton onClick={() => setOpen(true)}>確認を開く</AppButton><AppDialog open={open} onClose={() => setOpen(false)} title="保存の確認" actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpen(false)}>キャンセル</AppButton><AppButton onClick={() => setOpen(false)}>保存する</AppButton></>}><Typography>変更内容を保存しますか？</Typography></AppDialog></>;
};

const meta = { title: 'UI/AppDialog', component: DialogShowcase, tags: ['autodocs'] } satisfies Meta<typeof DialogShowcase>;
export default meta;
export const Confirmation: StoryObj<typeof meta> = {};

