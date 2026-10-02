'use client';

import { Box, Card, CardActionArea, Stack, Typography } from '@/components/ui/mui';
import { StatusChip } from '@/components/ui';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EditIcon from '@mui/icons-material/Edit';
import type { RecordFeedItem } from '@/utils/recordFeed';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';

export function RecordFeedCard({ item, onSelect }: { item: RecordFeedItem; onSelect: (item: RecordFeedItem) => void }) {
  const content = <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1.5}>
    <Box sx={{ minWidth: 0 }}>
      <Box display="flex" alignItems="center" gap={1} mb={0.5} flexWrap="wrap">
        <AccessTimeIcon fontSize="small" color="action" />
        <Typography variant="body2" fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{new Date(item.startAt).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Typography>
        <StatusChip label={item.kind === 'ai_submission' ? '送信済み・管理者確認待ち' : getReportStatusLabel(item.status)} tone={getReportStatusChipColor(item.status)} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
      </Box>
      <Typography variant="h6" fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{item.title}</Typography>
      {item.authorName && <Typography variant="body2" color="text.secondary">作成者: {item.authorName}</Typography>}
      {item.kind === 'internal' && <Typography variant="body2" color="text.secondary">内勤記録</Typography>}
      {item.detail && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{item.detail}</Typography>}
    </Box>
    {item.href && <EditIcon color="action" />}
  </Stack>;
  return <Card variant="outlined" sx={{ borderRadius: 2 }} data-record-key={`${item.kind}:${item.id}`}>
    {item.href ? <CardActionArea onClick={() => onSelect(item)} sx={{ p: { xs: 1.5, sm: 2 } }}>{content}</CardActionArea> : <Box sx={{ p: { xs: 1.5, sm: 2 } }}>{content}</Box>}
  </Card>;
}
