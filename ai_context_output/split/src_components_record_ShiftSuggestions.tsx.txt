'use client';

import { addShiftLink, getLinkedShifts, getShiftSuggestions, removeShiftLink } from '@/app/actions/reportShifts';
import { Alert, Box, Button, Chip, Typography } from '@/components/ui/mui';
import type { LinkedShift, ShiftSuggestion } from '@/hooks/useRecordForm';

type ShiftSuggestionsProps = {
  organizationId?: string;
  reportId: string | null;
  suggestions: ShiftSuggestion[];
  linkedShifts: LinkedShift[];
  dismissedSuggestions: Set<string>;
  onDismiss: (id: string) => void;
  onSuggestionsChange: (suggestions: ShiftSuggestion[]) => void;
  onLinkedShiftsChange: (shifts: LinkedShift[]) => void;
  onError: (message: string) => void;
};

const formatTime = (value: string) => new Date(value).toLocaleTimeString('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
});

export function ShiftSuggestions({
  organizationId,
  reportId,
  suggestions,
  linkedShifts,
  dismissedSuggestions,
  onDismiss,
  onSuggestionsChange,
  onLinkedShiftsChange,
  onError,
}: ShiftSuggestionsProps) {
  const handleLink = async (shiftId: string) => {
    if (!organizationId || !reportId) return;
    try {
      await addShiftLink(organizationId, reportId, shiftId);
      const [linked, nextSuggestions] = await Promise.all([
        getLinkedShifts(reportId),
        getShiftSuggestions(organizationId, reportId),
      ]);
      onLinkedShiftsChange(linked as LinkedShift[]);
      onSuggestionsChange(nextSuggestions);
    } catch (error) {
      console.error(error);
      onError('シフトの紐付けに失敗しました');
    }
  };

  const handleUnlink = async (shiftId: string) => {
    if (!organizationId || !reportId) return;
    try {
      await removeShiftLink(organizationId, reportId, shiftId);
      onLinkedShiftsChange((await getLinkedShifts(reportId)) as LinkedShift[]);
    } catch (error) {
      console.error(error);
      onError('シフトの解除に失敗しました');
    }
  };

  return (
    <>
      {suggestions.filter((suggestion) => !dismissedSuggestions.has(suggestion.id)).map((suggestion) => (
        <Alert
          key={suggestion.id}
          severity="warning"
          sx={{ mb: 1 }}
          action={(
            <Box display="flex" gap={1}>
              <Button size="small" onClick={() => void handleLink(suggestion.id)}>紐付ける</Button>
              <Button size="small" onClick={() => onDismiss(suggestion.id)}>無視する</Button>
            </Box>
          )}
        >
          {suggestion.staffName ?? 'スタッフ'}（{formatTime(suggestion.start_at)}〜{formatTime(suggestion.end_at)}）のシフトを紐付けますか？
        </Alert>
      ))}

      {linkedShifts.length > 0 && (
        <Box mb={2}>
          <Typography variant="subtitle2" gutterBottom>担当シフト</Typography>
          <Box display="flex" flexWrap="wrap" gap={1}>
            {linkedShifts.map((link) => {
              const shift = link.shifts;
              if (!shift) return null;
              const staffName = shift.shift_staffs?.[0]?.staffs?.name ?? '';
              return (
                <Chip
                  key={link.shift_id}
                  label={`${staffName} ${formatTime(shift.start_at)}〜${formatTime(shift.end_at)}${link.is_primary ? ' [主]' : ''}`}
                  onDelete={link.is_primary ? undefined : () => void handleUnlink(link.shift_id)}
                />
              );
            })}
          </Box>
        </Box>
      )}
    </>
  );
}
