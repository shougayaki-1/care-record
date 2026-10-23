import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AiImportFiles } from './AiImportFiles';

const meta = {
  title: 'AI Import/Files', component: AiImportFiles,
  args: { fileEntries: [], groups: [], selectedFileIds: new Set<string>(), pending: false, toggleSelectFile: fn(), ungroupFile: fn(), removeFile: fn(), mergeSelected: fn() },
} satisfies Meta<typeof AiImportFiles>;
export default meta;
type Story = StoryObj<typeof meta>;
const entries = ['a', 'b'].map((id) => ({ id, file: new File(['image'], `${id}.png`, { type: 'image/png' }), groupId: null, previewUrl: null }));
export const Empty: Story = { play: async ({ canvasElement }) => {
  await expect(within(canvasElement).queryByText(/ファイル選択中/)).not.toBeInTheDocument();
} };
export const Selected: Story = { args: { fileEntries: entries, selectedFileIds: new Set(['a', 'b']) }, play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText('2 ファイル選択中')).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: '1記録としてまとめる' }));
  await expect(args.mergeSelected).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: 'a.pngを削除' }));
  await expect(args.removeFile).toHaveBeenCalledWith('a');
} };
export const Grouped: Story = { args: { fileEntries: entries.map((entry) => ({ ...entry, groupId: 'group' })), groups: [{ id: 'group', fileIds: ['b', 'a'] }] }, play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText('グループ（2 ファイル → 1記録）')).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: 'b.pngをグループから外す' }));
  await expect(args.ungroupFile).toHaveBeenCalledWith('b');
} };
export const Processing: Story = { args: { fileEntries: entries, selectedFileIds: new Set(['a', 'b']), pending: true, progress: { processed: 1, total: 2 } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText('1 / 2 件処理中...')).toBeVisible();
  await expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  for (const control of [...canvas.getAllByRole('button'), ...canvas.getAllByRole('checkbox')]) await expect(control).toBeDisabled();
} };
