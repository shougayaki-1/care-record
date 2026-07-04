'use client';

import dynamic from 'next/dynamic';
import type { EventInput } from '@fullcalendar/core';
import {
  Box,
  Chip,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@/components/ui/mui';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { DataTable, StatusChip } from '@/components/ui';
import { ManualCallout, ManualDefinitionList, ManualDemoFrame, ManualScreenHighlight, ManualSection, ManualStep } from '@/components/manual/ManualPrimitives';
import { useState } from 'react';

const ShiftCalendarViewer = dynamic(
  () => import('@/components/shifts/ShiftCalendarViewer').then((mod) => mod.ShiftCalendarViewer),
  { ssr: false },
);

const allEvents: EventInput[] = [
  {
    id: 'all-1',
    title: '山田 太郎 様',
    start: '2026-07-06T09:00:00',
    end: '2026-07-06T10:30:00',
    backgroundColor: '#2255CC',
    borderColor: '#2255CC',
    extendedProps: { staffNames: '佐藤 花子', reportStatuses: [{ id: 'r1', status: 'approved', is_primary: true }] },
  },
  {
    id: 'all-2',
    title: '鈴木 花子 様',
    start: '2026-07-07T18:00:00',
    end: '2026-07-07T21:00:00',
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
    extendedProps: { staffNames: '田中 一郎', reportStatuses: [] },
  },
  {
    id: 'all-3',
    title: '高橋 健 様',
    start: '2026-07-09T08:00:00',
    end: '2026-07-09T09:00:00',
    backgroundColor: '#0F766E',
    borderColor: '#0F766E',
    extendedProps: { staffNames: '佐藤 花子', reportStatuses: [{ id: 'r2', status: 'draft', is_primary: true }] },
  },
];

const assignedOnlyEvents = allEvents.filter((event) => String(event.extendedProps?.staffNames ?? '').includes('佐藤'));

export default function RolesAndPermissionsManual() {
  return (
    <Stack spacing={3}>
      <ManualSection title="権限とロールの基本" subtitle="CareRecordでは、画面ごとに「全体」「担当のみ」「なし」の範囲を組み合わせて操作範囲を決めます。">
        <Stack spacing={1.5}>
          <ManualStep number={1} title="全体権限" body="事業所内の全利用者、全スタッフ、全シフト、全記録を確認できます。管理者や承認担当者向けです。" />
          <ManualStep number={2} title="担当のみ権限" body="自分が担当に入っている利用者・シフト・記録だけを確認できます。一般スタッフの日常利用に向きます。" />
          <ManualStep number={3} title="なし" body="該当メニューやデータを表示しません。管理機能は必要な担当者だけに付与します。" />
        </Stack>
      </ManualSection>

      <ManualSection title="権限設計の目安">
        <ManualDefinitionList
          items={[
            { term: '管理者', description: 'シフト作成、記録承認、統計確認が必要なため、シフト・記録は全体権限にします。' },
            { term: '一般スタッフ', description: '自分の担当シフトから記録を作成できればよいため、シフト・記録は担当のみ権限にします。' },
            { term: '事務担当', description: '帳票や統計だけ見るなど、業務範囲に応じて管理機能を限定します。' },
          ]}
        />
      </ManualSection>

      <RoleMatrixDemo />
      <CalendarPermissionDemo />
    </Stack>
  );
}

function RoleMatrixDemo() {
  const rows = [
    { id: 'admin', role: '管理者', records: '全体', shifts: '全体', clients: '全体', management: '許可' },
    { id: 'staff', role: '一般スタッフ', records: '担当のみ', shifts: '担当のみ', clients: '担当のみ', management: 'なし' },
    { id: 'office', role: '事務担当', records: '全体', shifts: '閲覧のみ', clients: '全体', management: '一部許可' },
  ];

  return (
    <ManualDemoFrame title="ロールごとの見える範囲">
      <ManualScreenHighlight number={1} label="全体 / 担当のみ / なしを画面ごとに設定">
        <DataTable
          rows={rows}
          getRowKey={(row) => row.id}
          columns={[
            { key: 'role', header: 'ロール', render: (row) => <Typography fontWeight={800}>{row.role}</Typography> },
            { key: 'records', header: '記録', render: (row) => <PermissionChip value={row.records} /> },
            { key: 'shifts', header: 'シフト', render: (row) => <PermissionChip value={row.shifts} /> },
            { key: 'clients', header: '利用者', render: (row) => <PermissionChip value={row.clients} /> },
            { key: 'management', header: '管理機能', render: (row) => <StatusChip label={row.management} tone={row.management === 'なし' ? 'default' : 'info'} size="small" /> },
          ]}
        />
      </ManualScreenHighlight>
    </ManualDemoFrame>
  );
}

function PermissionChip({ value }: { value: string }) {
  const tone = value === '全体' ? 'primary' : value === '担当のみ' ? 'warning' : 'default';
  return <Chip label={value} size="small" color={tone} variant={tone === 'default' ? 'outlined' : 'filled'} />;
}

function CalendarPermissionDemo() {
  const [tab, setTab] = useState<'all' | 'assigned'>('all');

  return (
    <ManualDemoFrame title="シフトカレンダーの見え方比較">
      <ManualScreenHighlight number={2} label="同じ月でも権限で表示対象が変わる">
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ display: { xs: 'flex', md: 'none' }, mb: 2 }}>
          <Tab value="all" label="全体権限" />
          <Tab value="assigned" label="担当のみ" />
        </Tabs>

        <Box sx={{ display: { xs: tab === 'all' ? 'block' : 'none', md: 'grid' }, gridTemplateColumns: { md: '1fr 1fr' }, gap: 2 }}>
          <CalendarPanel
            icon={<AdminPanelSettingsIcon color="primary" />}
            title="全体権限の管理者"
            description="全利用者・全スタッフの予定を確認できます。未作成や承認状態も俯瞰できます。"
            events={allEvents}
            badge="3件表示"
          />
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <CalendarPanel
              icon={<PersonIcon color="warning" />}
              title="担当のみ権限のスタッフ"
              description="自分が担当に入っているシフトだけが表示されます。ほかの利用者予定は見えません。"
              events={assignedOnlyEvents}
              badge="2件表示"
            />
          </Box>
        </Box>

        <Box sx={{ display: { xs: tab === 'assigned' ? 'block' : 'none', md: 'none' } }}>
          <CalendarPanel
            icon={<PersonIcon color="warning" />}
            title="担当のみ権限のスタッフ"
            description="自分が担当に入っているシフトだけが表示されます。ほかの利用者予定は見えません。"
            events={assignedOnlyEvents}
            badge="2件表示"
          />
        </Box>
      </ManualScreenHighlight>
      <ManualCallout tone="warning" title="担当のみ権限で見えない場合">
        利用者担当、シフト担当、スタッフ名簿、ログインアカウントとの紐付けを確認します。担当に入っていない予定は、正常に非表示になります。
      </ManualCallout>
    </ManualDemoFrame>
  );
}

function CalendarPanel({
  icon,
  title,
  description,
  events,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  events: EventInput[];
  badge: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        {icon}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography fontWeight={800}>{title}</Typography>
          <Typography variant="caption" color="text.secondary">{description}</Typography>
        </Box>
        <Chip label={badge} size="small" color="primary" variant="outlined" />
      </Stack>
      <Divider sx={{ mb: 1.5 }} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <CalendarMonthIcon color="action" fontSize="small" />
        <Typography variant="subtitle2" fontWeight={800}>2026年7月 シフト</Typography>
        <Box sx={{ flex: 1 }} />
        <Chip icon={<VisibilityIcon />} label={title.includes('全体') ? '全予定' : '自分の担当'} size="small" />
      </Stack>
      <Box sx={{ '& .fc-toolbar-title': { fontSize: '0.88rem !important' }, '& .fc-button': { minHeight: '30px !important', px: '8px !important' } }}>
        <ShiftCalendarViewer
          events={events}
          initialView="dayGridMonth"
          headerToolbar={{ left: 'prev,next', center: 'title', right: '' }}
          selectable={false}
          editable={false}
          onEventClick={() => undefined}
          onDateSelect={() => undefined}
          noEventsText="表示できるシフトはありません"
        />
      </Box>
      <Stack direction="row" spacing={1} mt={1} useFlexGap flexWrap="wrap">
        <Chip icon={<GroupsIcon />} label={title.includes('全体') ? '山田・鈴木・高橋を表示' : '佐藤担当分だけ表示'} size="small" variant="outlined" />
      </Stack>
    </Paper>
  );
}
