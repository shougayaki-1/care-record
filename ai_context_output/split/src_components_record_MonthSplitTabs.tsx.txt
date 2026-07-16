'use client';

import { Box, Tab, Tabs, Typography } from '@/components/ui/mui';

type MonthSplitTabsProps = {
  selectedPart: 'part1' | 'part2';
  originalShiftTimes: { start_at: string; end_at: string } | null;
  formatTimeForLabel: (date?: string) => string;
  onPartChange: (part: 'part1' | 'part2') => void | Promise<void>;
};

export function MonthSplitTabs({
  selectedPart,
  originalShiftTimes,
  formatTimeForLabel,
  onPartChange,
}: MonthSplitTabsProps) {
  return (
    <Box sx={{ p: 2, bgcolor: 'background.warning', borderColor: 'warning.light', borderRadius: 1 }}>
      <Typography variant="subtitle2" fontWeight="bold" color="warning.dark" mb={1.5}>
        ⚠ このシフトは月末を跨ぐ夜勤のため、請求都合上00:00で分割して記録を登録します。
      </Typography>
      <Tabs
        value={selectedPart}
        onChange={(_, value: 'part1' | 'part2') => void onPartChange(value)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
      >
        <Tab value="part1" label={`前半（月末日の24:00まで: ${formatTimeForLabel(originalShiftTimes?.start_at)} 〜 24:00）`} />
        <Tab value="part2" label={`後半（翌月1日の00:00から: 00:00 〜 ${formatTimeForLabel(originalShiftTimes?.end_at)}）`} />
      </Tabs>
    </Box>
  );
}
