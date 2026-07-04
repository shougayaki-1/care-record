'use client';

import { Box, Checkbox, Chip, Divider, IconButton, LinearProgress, Stack, Tab, Tabs, Tooltip, Typography } from '@/components/ui/mui';
import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import EditNoteIcon from '@mui/icons-material/EditNote';
import KeyIcon from '@mui/icons-material/Key';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PeopleIcon from '@mui/icons-material/People';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import SettingsIcon from '@mui/icons-material/Settings';
import SyncIcon from '@mui/icons-material/Sync';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import { AppButton, AppTextField, DataTable, DateTimeField, InnerPageHeader, PageHeader, StatusChip, SwitchField } from '@/components/ui';
import { ManualDemoFrame, ManualScreenHighlight } from './ManualPrimitives';

type DemoKind = 'clients' | 'record' | 'ai' | 'shifts' | 'reports' | 'roles' | 'logs' | 'internalWork';

export function ManualDemo({ kind }: { kind: DemoKind }) {
  if (kind === 'clients') return <ClientsDemo />;
  if (kind === 'record') return <RecordDemo />;
  if (kind === 'ai') return <AiImportDemo />;
  if (kind === 'shifts') return <ShiftDemo />;
  if (kind === 'reports') return <ReportsDemo />;
  if (kind === 'roles') return <RolesDemo />;
  if (kind === 'logs') return <LogsDemo />;
  return <InternalWorkDemo />;
}

function ClientsDemo() {
  const rows = [
    { id: '1', name: '山田 太郎', status: '有効', assignments: '2名' },
    { id: '2', name: '鈴木 花子', status: '有効', assignments: '担当未設定' },
  ];
  return (
    <ManualDemoFrame title="利用者管理一覧">
      <PageHeader
        title={<Stack direction="row" alignItems="center" gap={1}><PeopleIcon color="action" />利用者管理</Stack>}
        actions={<><SwitchField checked={false} onChange={() => undefined} label="アーカイブを表示" /><AppButton startIcon={<AddIcon />}>新規登録</AppButton></>}
      />
      <ManualScreenHighlight number={1} label="一覧で状態と担当者数を確認">
        <DataTable
          rows={rows}
          getRowKey={(row) => row.id}
          columns={[
            { key: 'name', header: '利用者氏名', render: (row) => row.name },
            { key: 'status', header: '状態', render: (row) => <StatusChip label={row.status} tone="success" /> },
            { key: 'assignments', header: '担当者数', render: (row) => row.assignments === '担当未設定' ? <StatusChip label="担当未設定" tone="warning" /> : row.assignments },
            { key: 'actions', header: '操作', align: 'right', render: () => (
              <Stack direction="row" justifyContent="flex-end" spacing={1}>
                <Tooltip title="氏名を編集"><IconButton size="small"><EditIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="詳細設定"><IconButton size="small" color="primary"><SettingsIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="アーカイブ"><IconButton size="small"><ArchiveIcon fontSize="small" /></IconButton></Tooltip>
              </Stack>
            ) },
          ]}
        />
      </ManualScreenHighlight>
    </ManualDemoFrame>
  );
}

function RecordDemo() {
  return (
    <ManualDemoFrame title="記録作成画面">
      <InnerPageHeader icon={<EditNoteIcon />} title="山田 太郎 様の記録" actions={<AppButton>保存</AppButton>} />
      <Stack spacing={2} sx={{ mt: 2 }}>
        <ManualScreenHighlight number={1} label="基本情報を確認">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <DateTimeField kind="date" label="サービス日" value="2026-07-04" />
            <DateTimeField kind="time" label="開始" value="09:00" />
            <DateTimeField kind="time" label="終了" value="10:30" />
            <AppTextField label="担当スタッフ" value="佐藤 花子" />
          </Stack>
        </ManualScreenHighlight>
        <ManualScreenHighlight number={2} label="利用者別フォームへ入力">
          <Stack spacing={1.5}>
            <SwitchField checked label="服薬確認" onChange={() => undefined} />
            <AppTextField label="食事・水分" value="朝食全量。水分 300ml。" multiline minRows={2} />
            <AppTextField label="特記事項" value="訪問時に体調確認。発熱なし。" multiline minRows={2} />
          </Stack>
        </ManualScreenHighlight>
      </Stack>
    </ManualDemoFrame>
  );
}

function AiImportDemo() {
  const rows = [
    { id: '1', file: '訪問記録_山田.pdf', client: '山田 太郎', staff: '佐藤 花子', status: '確認待ち' },
    { id: '2', file: 'IMG_2048.png', client: '鈴木 花子', staff: '候補なし', status: '修正必要' },
  ];
  return (
    <ManualDemoFrame title="AI一括取込レビュー">
      <PageHeader
        title={<Stack direction="row" alignItems="center" gap={1}><AutoFixHighIcon color="action" />AI一括取込</Stack>}
        description="PDFや画像から記録候補を抽出し、保存前に人が確認します。"
        actions={<><AppButton variant="outlined" startIcon={<UploadFileIcon />}>ファイル追加</AppButton><AppButton startIcon={<AutoFixHighIcon />}>抽出開始</AppButton></>}
      />
      <ManualScreenHighlight number={1} label="処理状況とレビュー対象">
        <Stack spacing={1.5}>
          <LinearProgress variant="determinate" value={65} />
          <DataTable
            rows={rows}
            getRowKey={(row) => row.id}
            columns={[
              { key: 'file', header: 'ファイル', render: (row) => row.file },
              { key: 'client', header: '利用者', render: (row) => row.client },
              { key: 'staff', header: 'スタッフ', render: (row) => row.staff === '候補なし' ? <StatusChip label="候補なし" tone="warning" /> : row.staff },
              { key: 'status', header: '状態', render: (row) => <StatusChip label={row.status} tone={row.status === '修正必要' ? 'warning' : 'info'} /> },
            ]}
          />
        </Stack>
      </ManualScreenHighlight>
    </ManualDemoFrame>
  );
}

function ShiftDemo() {
  return (
    <ManualDemoFrame title="シフト管理カレンダー">
      <PageHeader
        title={<Stack direction="row" alignItems="center" gap={1}><CalendarMonthIcon color="action" />シフト管理</Stack>}
        actions={<><AppButton variant="outlined" startIcon={<PictureAsPdfIcon />}>PDF出力</AppButton><AppButton startIcon={<AddIcon />}>新規シフト</AppButton></>}
      />
      <Tabs value="calendar" aria-label="シフト表示切替" sx={{ mb: 2 }}>
        <Tab value="patterns" label="基本パターン" />
        <Tab value="calendar" label="全体カレンダー" />
        <Tab value="my" label="自分のシフト" />
        <Tab value="staff" label="スタッフ別" />
      </Tabs>
      <ManualScreenHighlight number={1} label="日付ごとの予定を確認">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(88px, 1fr))', borderTop: 1, borderLeft: 1, borderColor: 'divider', minWidth: 720 }}>
          {['月', '火', '水', '木', '金', '土', '日'].map((day, index) => (
            <Box key={day} sx={{ minHeight: 110, borderRight: 1, borderBottom: 1, borderColor: 'divider', p: 1, bgcolor: index > 4 ? 'background.subtle' : 'background.paper' }}>
              <Typography variant="caption" fontWeight={800}>{day}</Typography>
              {index === 1 && <ShiftEvent time="09:00-10:30" title="山田 太郎 様" />}
              {index === 3 && <ShiftEvent time="18:00-翌09:00" title="鈴木 花子 様" overnight />}
            </Box>
          ))}
        </Box>
      </ManualScreenHighlight>
      <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
        <AppButton variant="outlined" startIcon={<SyncIcon />}>Google同期修復</AppButton>
        <AppButton variant="outlined">一括自動展開</AppButton>
      </Stack>
    </ManualDemoFrame>
  );
}

function ShiftEvent({ time, title, overnight = false }: { time: string; title: string; overnight?: boolean }) {
  return (
    <Box sx={{ mt: 1, p: 0.75, borderLeft: 3, borderColor: overnight ? 'warning.main' : 'primary.main', bgcolor: 'background.tint' }}>
      <Typography variant="caption" color={overnight ? 'warning.main' : 'primary.main'} fontWeight={800} display="block">{time}</Typography>
      <Typography variant="caption" fontWeight={800}>{title}</Typography>
    </Box>
  );
}

function ReportsDemo() {
  const rows = [
    { id: '1', date: '2026/07/04', client: '山田 太郎', staff: '佐藤 花子', status: '未承認' },
    { id: '2', date: '2026/07/03', client: '鈴木 花子', staff: '田中 一郎', status: '承認済み' },
  ];
  return (
    <ManualDemoFrame title="提供記録一覧・承認">
      <PageHeader
        title="提供記録一覧"
        actions={<><AppButton variant="outlined" startIcon={<PictureAsPdfIcon />}>PDF</AppButton><AppButton startIcon={<CheckCircleIcon />}>承認</AppButton></>}
      />
      <ManualScreenHighlight number={1} label="状態で絞り込み、内容確認後に承認">
        <DataTable
          rows={rows}
          getRowKey={(row) => row.id}
          columns={[
            { key: 'date', header: '日付', render: (row) => row.date },
            { key: 'client', header: '利用者', render: (row) => row.client },
            { key: 'staff', header: '担当', render: (row) => row.staff },
            { key: 'status', header: '状態', render: (row) => <StatusChip label={row.status} tone={row.status === '未承認' ? 'warning' : 'success'} /> },
            { key: 'actions', header: '操作', align: 'right', render: () => <AppButton size="small" variant="outlined">詳細</AppButton> },
          ]}
        />
      </ManualScreenHighlight>
    </ManualDemoFrame>
  );
}

function RolesDemo() {
  const rows = [
    { id: 'owner', role: 'オーナー', records: '全件', shifts: '全件', management: '全管理' },
    { id: 'manager', role: '管理者', records: '全件', shifts: '全件', management: '一部管理' },
    { id: 'staff', role: '一般スタッフ', records: '担当のみ', shifts: '担当のみ', management: 'なし' },
  ];
  return (
    <ManualDemoFrame title="ロール・権限管理">
      <PageHeader title={<Stack direction="row" alignItems="center" gap={1}><KeyIcon color="action" />アカウント・権限管理</Stack>} actions={<AppButton startIcon={<AddIcon />}>招待</AppButton>} />
      <ManualScreenHighlight number={1} label="ロールごとの権限範囲">
        <DataTable
          rows={rows}
          getRowKey={(row) => row.id}
          columns={[
            { key: 'role', header: 'ロール', render: (row) => row.role },
            { key: 'records', header: '記録', render: (row) => <Chip label={row.records} size="small" /> },
            { key: 'shifts', header: 'シフト', render: (row) => <Chip label={row.shifts} size="small" /> },
            { key: 'management', header: '管理', render: (row) => <Chip label={row.management} size="small" color={row.management === 'なし' ? 'default' : 'primary'} /> },
          ]}
        />
      </ManualScreenHighlight>
    </ManualDemoFrame>
  );
}

function LogsDemo() {
  const rows = [
    { id: '1', time: '2026/07/04 09:12', actor: '佐藤 花子', event: '記録を保存', result: '成功' },
    { id: '2', time: '2026/07/04 08:55', actor: '管理者', event: '権限を変更', result: '成功' },
  ];
  return (
    <ManualDemoFrame title="ログ・バックアップ閲覧">
      <PageHeader title={<Stack direction="row" alignItems="center" gap={1}><ListAltIcon color="action" />ログ</Stack>} actions={<AppButton variant="outlined">CSVエクスポート</AppButton>} />
      <ManualScreenHighlight number={1} label="操作履歴を監査できる形で確認">
        <DataTable
          rows={rows}
          getRowKey={(row) => row.id}
          columns={[
            { key: 'time', header: '日時', render: (row) => row.time },
            { key: 'actor', header: '操作者', render: (row) => row.actor },
            { key: 'event', header: '操作', render: (row) => row.event },
            { key: 'result', header: '結果', render: (row) => <StatusChip label={row.result} tone="success" /> },
          ]}
        />
      </ManualScreenHighlight>
    </ManualDemoFrame>
  );
}

function InternalWorkDemo() {
  return (
    <ManualDemoFrame title="内勤を記録">
      <InnerPageHeader icon={<WorkHistoryIcon />} title="内勤を記録" actions={<AppButton>保存</AppButton>} />
      <Stack spacing={2} sx={{ mt: 2 }}>
        <ManualScreenHighlight number={1} label="訪問以外の業務時間を登録">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <DateTimeField kind="date" label="日付" value="2026-07-04" />
            <DateTimeField kind="time" label="開始" value="13:00" />
            <DateTimeField kind="time" label="終了" value="14:00" />
            <AppTextField label="業務内容" value="記録確認・電話対応" />
          </Stack>
        </ManualScreenHighlight>
        <Divider />
        <Stack direction="row" alignItems="center" spacing={1}>
          <Checkbox checked />
          <Typography variant="body2">統計・労務集計の対象にする</Typography>
        </Stack>
      </Stack>
    </ManualDemoFrame>
  );
}
