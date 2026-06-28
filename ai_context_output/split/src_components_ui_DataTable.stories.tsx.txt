import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Box } from '@mui/material';
import { DataTable } from './DataTable';

type Row = { id: number; name: string; status: string };
const rows: Row[] = [{ id: 1, name: '山田 太郎', status: '有効' }, { id: 2, name: '佐藤 花子', status: '未承認' }];
const columns = [
  { key: 'name', header: '氏名', render: (row: Row) => row.name },
  { key: 'status', header: '状態', render: (row: Row) => row.status },
];

const meta = { title: 'UI/DataTable', component: DataTable<Row>, tags: ['autodocs'], decorators: [(Story) => <Box sx={{ width: 640 }}><Story /></Box>] } satisfies Meta<typeof DataTable<Row>>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WithRows: Story = { args: { rows, columns, getRowKey: (row) => row.id } };
export const Empty: Story = { args: { rows: [], columns, getRowKey: (row) => row.id, emptyTitle: '登録がありません' } };
