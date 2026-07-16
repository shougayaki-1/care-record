'use client';

import dynamic from 'next/dynamic';
import type { EventInput } from '@fullcalendar/core';
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@/components/ui/mui';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import LockIcon from '@mui/icons-material/Lock';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import SyncIcon from '@mui/icons-material/Sync';
import UpdateIcon from '@mui/icons-material/Update';
import { AppButton, DataTable, DateTimeField, PageHeader, StatusChip } from '@/components/ui';
import { ManualCallout, ManualDefinitionList, ManualDemoFrame, ManualScreenHighlight, ManualSection, ManualStep } from '@/components/manual/ManualPrimitives';

const ShiftCalendarViewer = dynamic(
  () => import('@/components/shifts/ShiftCalendarViewer').then((mod) => mod.ShiftCalendarViewer),
  { ssr: false },
);

const calendarEvents: EventInput[] = [
  {
    id: 'shift-overnight',
    title: '鈴木 一郎 様',
    start: '2026-07-05T22:00:00',
    end: '2026-07-06T09:00:00',
    backgroundColor: '#2255CC',
    borderColor: '#2255CC',
    extendedProps: { staffNames: '佐藤 花子', reportStatuses: [] },
  },
  {
    id: 'shift-day',
    title: '山田 太郎 様',
    start: '2026-07-07T09:00:00',
    end: '2026-07-07T10:30:00',
    backgroundColor: '#0F766E',
    borderColor: '#0F766E',
    extendedProps: { staffNames: '田中 一郎', reportStatuses: [{ id: 'r1', status: 'approved', is_primary: true }] },
  },
  {
    id: 'shift-mobile',
    title: '高橋 健 様',
    start: '2026-07-09T14:00:00',
    end: '2026-07-09T16:00:00',
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
    extendedProps: { staffNames: '佐藤 花子', reportStatuses: [{ id: 'r2', status: 'rejected', is_primary: true }] },
  },
];

const patternRows = [
  { id: 'p1', client: '鈴木 一郎 様', service: '重度訪問介護', cycle: '毎週日曜', time: '22:00-翌09:00', staff: '佐藤 花子', status: '展開対象' },
  { id: 'p2', client: '山田 太郎 様', service: '身体介護', cycle: '毎週火曜', time: '09:00-10:30', staff: '田中 一郎', status: '展開対象' },
  { id: 'p3', client: '高橋 健 様', service: '移動支援', cycle: '第2・第4木曜', time: '14:00-16:00', staff: '佐藤 花子', status: '手動調整あり' },
];

export default function ShiftGuideManual() {
  return (
    <Stack spacing={3}>
      <ManualSection title="シフト管理が解決すること" subtitle="紙の月間表やExcelで起きやすい転記漏れ、担当共有漏れ、上書き事故を防ぎます。">
        <Stack spacing={1.5}>
          <ManualStep number={1} title="ひな形から月次予定を作る" body="毎週・隔週などの繰り返しパターンを登録し、対象月へ一括展開します。毎月同じ予定を手入力する時間を削減できます。" />
          <ManualStep number={2} title="現場には必要な予定だけ見せる" body="管理者は全体、スタッフは担当のみを表示できます。利用者情報を必要以上に広げない運用にできます。" />
          <ManualStep number={3} title="手動修正を保護する" body="展開後に個別修正したシフトは is_modified として扱い、次回の自動展開で意図せず上書きしない安全設計です。" />
        </Stack>
      </ManualSection>

      <CalendarComparisonDemo />
      <MonthlyExpansionDemo />
    </Stack>
  );
}

function CalendarComparisonDemo() {
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const mineEvents = useMemo(() => calendarEvents.filter((event) => String(event.extendedProps?.staffNames ?? '').includes('佐藤')), []);

  return (
    <ManualDemoFrame title="シフトカレンダー：全体権限と担当のみ権限の比較">
      <ManualScreenHighlight number={1} label="同じ事業所でもロールで見える範囲が変わる">
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
          <Tab value="all" label="管理者: 全体権限" />
          <Tab value="mine" label="スタッフ: 担当のみ" />
        </Tabs>
        <Stack spacing={1.5}>
          <Alert severity={tab === 'all' ? 'info' : 'warning'}>
            {tab === 'all'
              ? '管理者は全利用者・全スタッフの予定、記録ステータス、未作成シフトを俯瞰できます。'
              : '担当のみ権限では、自分が担当に入っている予定だけが表示されます。'}
          </Alert>
          <Box sx={{ '& .fc-toolbar-title': { fontSize: '0.95rem !important' }, '& .fc-button': { minHeight: '30px !important' } }}>
            <ShiftCalendarViewer
              events={tab === 'all' ? calendarEvents : mineEvents}
              initialView="dayGridMonth"
              headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' }}
              buttonText={{ today: '今日', month: '月', week: '週', list: '一覧' }}
              selectable={false}
              editable={false}
              onEventClick={() => undefined}
              onDateSelect={() => undefined}
              noEventsText="表示できるシフトはありません"
            />
          </Box>
        </Stack>
      </ManualScreenHighlight>
    </ManualDemoFrame>
  );
}

function MonthlyExpansionDemo() {
  const [expanded, setExpanded] = useState(false);
  const progress = expanded ? 100 : 0;

  return (
    <ManualDemoFrame title="ひな形からの月次一括展開フロー">
      <Stack spacing={2.5}>
        <ManualScreenHighlight number={2} label="基本パターンを月へ展開">
          <PageHeader
            title={<Stack direction="row" alignItems="center" spacing={1}><CalendarMonthIcon color="action" />シフト基本パターン</Stack>}
            description="繰り返し予定を登録しておくと、月初作業を一括化できます。"
            actions={<AppButton startIcon={<AutoAwesomeIcon />} onClick={() => setExpanded(true)}>2026年7月へ一括自動展開</AppButton>}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <DateTimeField kind="month" label="展開対象月" value="2026-07" slotProps={{ input: { readOnly: true } }} />
            <AppButton variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={() => undefined}>月間PDFプレビュー</AppButton>
            <AppButton variant="outlined" startIcon={<SyncIcon />} onClick={() => undefined}>Googleカレンダー同期</AppButton>
          </Stack>
          <DataTable
            rows={patternRows}
            getRowKey={(row) => row.id}
            columns={[
              { key: 'client', header: '利用者', render: (row) => <Typography fontWeight={800}>{row.client}</Typography> },
              { key: 'service', header: 'サービス', render: (row) => row.service },
              { key: 'cycle', header: 'サイクル', render: (row) => <Chip label={row.cycle} variant="outlined" /> },
              { key: 'time', header: '時間', render: (row) => row.time },
              { key: 'staff', header: '既定担当', render: (row) => row.staff },
              { key: 'status', header: '状態', render: (row) => row.status === '手動調整あり' ? <StatusChip label="上書き保護" tone="warning" /> : <StatusChip label="展開対象" tone="success" /> },
            ]}
          />
        </ManualScreenHighlight>

        <ManualScreenHighlight number={3} label="自動展開後の安全設計">
          <Stack spacing={2}>
            <Box>
              <LinearProgress variant="determinate" value={progress} sx={{ height: 8, borderRadius: 1 }} />
              <Typography variant="caption" color="text.secondary">{expanded ? '42件のシフトを作成、手動調整済み3件は保護しました。' : '一括自動展開を押すと、対象月のシフト候補を作成します。'}</Typography>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
              <SafetyCard icon={<AutoAwesomeIcon color="primary" />} title="一括作成" body="ひな形から日付を計算し、月内の予定をまとめて作成します。" />
              <SafetyCard icon={<LockIcon color="warning" />} title="上書き保護" body="現場都合で時間変更した予定は is_modified として保護し、再展開で消しません。" />
              <SafetyCard icon={<UpdateIcon color="success" />} title="同期修復" body="Google側の認証切れや未同期があっても、未同期を同期・同期を修復から復旧できます。" />
            </Box>
          </Stack>
        </ManualScreenHighlight>
      </Stack>

      <ManualDefinitionList
        items={[
          { term: '月次作業の短縮', description: '毎月のExcelコピー、日付変更、担当者への共有をCareRecord上の展開と同期に集約します。' },
          { term: '日跨ぎ夜勤', description: '22:00-翌09:00のような予定もカレンダー上に表示し、記録作成時には月末跨ぎの分割入力へつなげます。' },
          { term: '記録との連動', description: 'シフトに記録ステータスが紐付くため、月末に未作成・差戻し・承認済みを確認しやすくなります。' },
        ]}
      />
      <ManualCallout tone="success" title="提案ポイント">
        CareRecordのシフトは「予定表」だけで終わらず、記録作成、予実管理、帳票、Googleカレンダー同期までつながる業務の起点になります。
      </ManualCallout>
    </ManualDemoFrame>
  );
}

function SafetyCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          {icon}
          <Typography fontWeight={800}>{title}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">{body}</Typography>
      </Stack>
    </Paper>
  );
}
