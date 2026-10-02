import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useRef } from 'react';
import { Box } from '@mui/material';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AiFilePicker } from './AiFilePicker';
const meta = { title: 'UI/AiFilePicker', component: AiFilePicker, args: { inputRef: { current: null }, onChange: fn(), onDrop: fn() }, render: function Picker(args) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <Box sx={{ width: 320, maxWidth: '100%' }}><AiFilePicker {...args} inputRef={inputRef} /></Box>;
} } satisfies Meta<typeof AiFilePicker>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Single: Story = { play: async ({ canvasElement, args }) => {
  const input = within(canvasElement).getByLabelText('記録ファイル');
  await userEvent.upload(input, new File(['test'], 'record.pdf', { type: 'application/pdf' }));
  await expect(args.onChange).toHaveBeenCalledOnce();
} };
export const Multiple: Story = { args: { multiple: true } };
export const Disabled: Story = { args: { disabled: true } };
