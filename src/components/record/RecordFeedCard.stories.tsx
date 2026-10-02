import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { RecordFeedCard } from './RecordFeedCard';
const meta = { title: 'Record/RecordFeedCard', component: RecordFeedCard, args: { item: { id: 'record-1', kind: 'report', title: '利用者 様', startAt: '2026-10-02T09:00:00+09:00', status: 'pending', authorName: '担当スタッフ', href: '/app/record/client?reportId=record-1' }, onSelect: fn() } } satisfies Meta<typeof RecordFeedCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Report: Story = { play: async ({ args, canvasElement }) => { await userEvent.click(within(canvasElement).getByRole('button')); await expect(args.onSelect).toHaveBeenCalledWith(args.item); } };
export const Internal: Story = { args: { item: { id: 'work-1', kind: 'internal', title: '会議', startAt: '2026-10-02T10:00:00+09:00', status: 'pending', authorName: '担当スタッフ', detail: '担当スタッフ · 1.00時間' } } };
export const AiSubmission: Story = { args: { item: { id: 'candidate-1', kind: 'ai_submission', title: 'AI利用者', startAt: '2026-10-02T11:00:00+09:00', status: 'pending', authorName: '担当スタッフ', detail: 'AI送信 · 管理者確認待ち' } } };
export const ApprovedAiReport: Story = { args: { item: { ...meta.args.item, status: 'approved' } } };

export const NarrowScreens: Story = {
  render: (args) => <div data-testid="feed-width">
    {[meta.args.item, Internal.args!.item!, AiSubmission.args!.item!].map((item) =>
      <RecordFeedCard key={item.id} item={{ ...item, title: '長い日本語の記録タイトルと利用者名の表示を確認します' }} onSelect={args.onSelect} />)}
  </div>,
  play: async ({ canvasElement }) => {
    const container = within(canvasElement).getByTestId('feed-width');
    for (const width of [240, 320, 375, 1280]) {
      container.style.width = `${width}px`;
      await expect(container.scrollWidth).toBeLessThanOrEqual(width);
    }
  },
};
