import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within, waitFor } from 'storybook/test';
import { ToastProvider } from './ToastProvider';
import { AiImportButton } from './AiImportButton';
const meta = { title: 'UI/AiImportButton', component: AiImportButton, decorators: [(Story) => <ToastProvider><Story /></ToastProvider>], args: { organizationId: 'org-1', formTemplate: [], clients: [], helpers: [], onExtracted: fn() } } satisfies Meta<typeof AiImportButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ChooseFile: Story = { play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'AIで読み取り' }));
  const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', { name: 'AIで記録を読み取る' });
  await expect(within(dialog).getByRole('button', { name: '処理開始' })).toBeDisabled();
  await userEvent.upload(within(dialog).getByLabelText('記録ファイル'), new File(['test'], 'record.pdf', { type: 'application/pdf' }));
  await expect(within(dialog).getByText('record.pdf')).toBeVisible();
  await expect(within(dialog).getByRole('button', { name: '処理開始' })).toBeEnabled();
} };
export const OverwriteConfirmation: Story = { args: { hasExistingValues: true }, play: async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'AIで読み取り（上書き）' }));
  const dialog = body.getByRole('dialog', { name: 'AIで記録を読み取る' });
  await userEvent.upload(within(dialog).getByLabelText('記録ファイル'), new File(['test'], 'record.pdf', { type: 'application/pdf' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '処理開始' }));
  await waitFor(() => expect(body.getByRole('dialog', { name: '確認' })).toBeVisible());
} };
export const Disabled: Story = { args: { disabled: true } };
