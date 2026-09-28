import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Box, Button, Typography } from '@/components/ui/mui';
import { RecordListTable, type RecordListRow } from './RecordListTable';

const rows: RecordListRow[] = [
  { id: '1', status: '承認待ち', statusColor: 'warning', start: '2026/09/28 09:00', end: '2026/09/28 10:00', client: '山田 太郎', helper: '佐藤 花子', actions: <Button size="small" variant="outlined">詳細</Button> },
  { id: '2', status: '承認済', statusColor: 'success', start: '2026/09/27 13:00', end: '2026/09/27 14:00', client: '鈴木 一郎', helper: '田中 次郎', actions: <Button size="small" variant="outlined">詳細</Button> },
];

const meta = {
  title: 'Records/RecordListTable',
  component: RecordListTable,
  tags: ['autodocs'],
  decorators: [(Story) => <Box sx={{ width: 850, maxWidth: '100%' }}><Story /></Box>],
} satisfies Meta<typeof RecordListTable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Reports: Story = { args: { rows, selectedIds: ['1'], onToggle: () => {}, onSelectAll: () => {} } };
export const AiPending: Story = { args: { rows: [{ ...rows[0], status: '送信済み・要確認', detail: <Typography variant="caption" color="warning.main">AI取込・原本要確認</Typography>, actions: <Button size="small" variant="outlined">内容を確認・修正</Button> }] } };
export const Empty: Story = { args: { rows: [], emptyMessage: '確認待ちのAI送信がありません' } };
