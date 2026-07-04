'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Box, Typography, CircularProgress, Stack, Chip, Paper,
  IconButton, ToggleButton, ToggleButtonGroup, Tooltip
} from '@/components/ui/mui';
import { CalendarPageSkeleton } from '@/components/ui';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ListIcon from '@mui/icons-material/List';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ArticleIcon from '@mui/icons-material/Article';
import type FullCalendar from '@fullcalendar/react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { getMyShiftsWithStatus, type MyShiftItem } from '@/app/actions/shift';
import { convertToCalendarEvents } from '@/utils/shiftHelper';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';

type ViewMode = 'list' | 'calendar';

const ShiftCalendarViewer = dynamic(
  () => import('@/components/shifts/ShiftCalendarViewer').then((mod) => mod.ShiftCalendarViewer),
  {
    ssr: false,
    loading: () => <CalendarPageSkeleton />,
  }
);

function formatDateLabel(startAt: string): string {
  const d = new Date(startAt);
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
}

function formatTimeRange(startAt: string, endAt: string): string {
  const fmt = (s: string) => {
    const d = new Date(s);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${fmt(startAt)} 〜 ${fmt(endAt)}`;
}

function ShiftListItem({
  shift, onClick, onViewReports,
}: {
  shift: MyShiftItem;
  onClick: () => void;
  onViewReports: () => void;
}) {
  const isCancelled = shift.status === 'cancelled';
  const clientName = shift.clients?.name ?? '';
  const reportStatus = shift.report?.status;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        opacity: isCancelled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Box
        sx={{ flexGrow: 1, minWidth: 0, cursor: isCancelled ? 'default' : 'pointer' }}
        onClick={isCancelled ? undefined : onClick}
      >
        <Typography variant="caption" color="text.secondary">
          {formatDateLabel(shift.start_at)}
        </Typography>
        <Typography variant="subtitle2" fontWeight="bold" noWrap>
          {isCancelled && (
            <Chip label="休" size="small" color="default" sx={{ mr: 1, height: 18, fontSize: '0.7rem' }} />
          )}
          {clientName} 様
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatTimeRange(shift.start_at, shift.end_at)}
        </Typography>
      </Box>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
        {isCancelled ? (
          <Chip label="キャンセル" size="small" color="default" variant="outlined" />
        ) : reportStatus ? (
          <Chip label={getReportStatusLabel(reportStatus)} size="small" color={getReportStatusChipColor(reportStatus)} />
        ) : (
          <Chip label="未記録" size="small" color="default" variant="outlined" icon={<EditNoteIcon />} />
        )}
        {!isCancelled && (
          <Tooltip title="記録を確認">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onViewReports(); }}>
              <ArticleIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Paper>
  );
}

export default function MyShiftsPage() {
  const router = useRouter();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const calendarRef = useRef<FullCalendar>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [shifts, setShifts] = useState<MyShiftItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const fetchShifts = useCallback(async (month: string) => {
    if (!currentOrg) return;
    setLoading(true);
    try {
      const [year, mon] = month.split('-').map(Number);
      const startDate = new Date(year, mon - 1, 1).toISOString();
      const endDate = new Date(year, mon, 1).toISOString();
      const data = await getMyShiftsWithStatus(currentOrg.id, startDate, endDate);
      setShifts(data);
    } catch (e) {
      console.error(e);
      showToast('シフトの取得に失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentOrg, showToast]);

  useEffect(() => {
    if (!wsLoading && currentOrg) {
      void fetchShifts(currentMonth);
    }
  }, [wsLoading, currentOrg, currentMonth, fetchShifts]);

  const handlePrevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleShiftClick = (clientId: string, shiftId: string, isCancelled: boolean) => {
    if (isCancelled) {
      showToast('このシフトはキャンセルされています', 'info');
      return;
    }
    router.push(`/app/record/${clientId}?shiftId=${shiftId}`);
  };

  const handleViewReports = (shiftId: string) => {
    router.push(`/app/reports?shiftId=${shiftId}`);
  };

  const [year, month] = currentMonth.split('-').map(Number);
  const monthLabel = `${year}年${month}月`;

  const calendarEvents = convertToCalendarEvents(shifts, true);

  if (wsLoading || !currentOrg) return <CalendarPageSkeleton />;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 2, sm: 3 }, py: 2, flexShrink: 0 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
          <Typography variant="h6" fontWeight="bold">自分のシフト</Typography>
          <ToggleButtonGroup
            size="small"
            value={viewMode}
            exclusive
            onChange={(_, v) => { if (v) setViewMode(v as ViewMode); }}
          >
            <ToggleButton value="list">
              <Tooltip title="リスト表示"><ListIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="calendar">
              <Tooltip title="カレンダー表示"><CalendarMonthIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {viewMode === 'list' && (
          <Stack direction="row" alignItems="center" spacing={1} mt={1}>
            <IconButton size="small" onClick={handlePrevMonth}><ChevronLeftIcon /></IconButton>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ minWidth: 100, textAlign: 'center' }}>
              {monthLabel}
            </Typography>
            <IconButton size="small" onClick={handleNextMonth}><ChevronRightIcon /></IconButton>
          </Stack>
        )}
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
        {loading ? (
          <Box display="flex" justifyContent="center" pt={8}><CircularProgress /></Box>
        ) : viewMode === 'list' ? (
          <Stack spacing={1.5} maxWidth={600} mx="auto">
            {shifts.length === 0 ? (
              <Typography color="text.secondary" textAlign="center" mt={6}>
                この月のシフトはありません
              </Typography>
            ) : (
              shifts.map(shift => (
                <ShiftListItem
                  key={shift.id}
                  shift={shift}
                  onClick={() => handleShiftClick(shift.client_id, shift.id, shift.status === 'cancelled')}
                  onViewReports={() => handleViewReports(shift.id)}
                />
              ))
            )}
          </Stack>
        ) : (
          <ShiftCalendarViewer
            calendarRef={calendarRef}
            events={calendarEvents}
            initialView="listMonth"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'listMonth,dayGridMonth' }}
            buttonText={{ listMonth: 'リスト', dayGridMonth: '月間' }}
            noEventsText="この月のシフトはありません"
            onDatesSet={(info) => {
              const d = info.start;
              const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              setCurrentMonth(m);
            }}
            onEventClick={(info) => {
              const { clientId, shiftId, isCancelled } = info.event.extendedProps;
              handleShiftClick(clientId as string, shiftId as string, isCancelled as boolean);
            }}
          />
        )}
      </Box>
    </Box>
  );
}
