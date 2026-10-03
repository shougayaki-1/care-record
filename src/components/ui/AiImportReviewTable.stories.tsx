import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within, waitFor } from 'storybook/test';
import { AiImportReviewTable, type ReviewRow } from './AiImportReviewTable';
const sampleRow: ReviewRow = { id: 'row-1', fileIndex: 0, fileName: 'record.pdf', fileType: 'application/pdf', previewUrl: null, fileCount: 1, date: '2026-10-02', startAt: '09:00', endAt: '10:00', clientId: 'client-1', helperId: 'helper-1', travelTime: '0.5', travelMethod: 'none', travelCostYen: '0', status: 'pending', result: { meta: { date: '2026-10-02', start_at: '09:00', end_at: '10:00', client_name: 'テスト利用者', helper_names: ['テスト担当'], client_id_candidate: 'client-1', helper_id_candidates: ['helper-1'] }, values: { note: '原本と照合してください' }, confidence: 'high', warnings: ['特記事項: 判読が難しい部分があります'] } };
const meta = { title: 'UI/AiImportReviewTable', component: AiImportReviewTable, parameters: { layout: 'fullscreen' }, args: { rows: [sampleRow], clients: [{ id: 'client-1', name: 'テスト利用者' }], helpers: [{ id: 'helper-1', name: 'テスト担当' }], formTemplate: [{ id: 'note', label: '特記事項', type: 'text', required: false }], onRowChange: fn(), onSaveSelected: fn(), onApproveRow: fn().mockResolvedValue(true), saving: false }, render: function Review(args) {
  const [rows, setRows] = useState(args.rows);
  return <AiImportReviewTable {...args} rows={rows} onRowChange={(id, changes) => setRows((previous) => previous.map((row) => row.id === id ? { ...row, ...changes } : row))} />;
} } satisfies Meta<typeof AiImportReviewTable>;
export default meta;
type Story = StoryObj<typeof meta>;
const openReview: Story['play'] = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getAllByRole('button', { name: '内容を確認・修正' })[0]);
  const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', { name: '提供記録の確認・修正' });
  await waitFor(() => expect(within(dialog).getByRole('group', { name: '記録操作' })).toBeVisible());
  await expect(within(dialog).getByLabelText(/利用者/)).toBeVisible();
  await expect(within(dialog).getByLabelText(/担当スタッフ/)).toBeVisible();
  await expect(within(dialog).getByText('特記事項: 判読が難しい部分があります')).toBeVisible();
};
export const DraftReview: Story = { play: openReview };
export const SubmittedReview: Story = { args: { workflow: 'review_submissions' }, play: openReview };
export const Processing: Story = { args: { workflow: 'review_submissions', saving: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getAllByRole('button', { name: '内容を確認・修正' })[0]).toBeDisabled();
  await expect(canvas.getByRole('button', { name: '却下' })).toBeDisabled();
} };
export const SaveFailure: Story = { args: { rows: [{ ...sampleRow, status: 'confirmed', saveStatus: 'error', saveError: '保存に失敗しました。入力内容を確認して再試行してください。' }] }, play: openReview };
