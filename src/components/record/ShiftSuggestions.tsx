'use client';

import { getActionErrorMessage, needsActionRecovery, readActionResult } from '@/utils/actionResult';

import { useState } from 'react';
import { RecoveryLogoutButton } from '@/components/auth/RecoveryLogoutButton';
import { addShiftLink, getLinkedShifts, getShiftSuggestions, removeShiftLink } from '@/app/actions/reportShifts';
import { Alert, Box, Button, Chip, Typography } from '@/components/ui/mui';
import type { LinkedShift, ShiftSuggestion } from '@/hooks/useRecordForm';

type ShiftSuggestionsProps = {
  disabled?: boolean;
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
  disabled = false,
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
  const [failure, setFailure] = useState<{ scope: string; cause: unknown } | null>(null);
  const scope = `${organizationId ?? ''}:${reportId ?? ''}`;
  const error = failure?.scope === scope ? failure.cause : null;
  const handleLink = async (shiftId: string) => {
    if (disabled || !organizationId || !reportId) return;
    setFailure(null);
    try {
      await readActionResult(addShiftLink(organizationId, reportId, shiftId));
      const [linked, nextSuggestions] = await Promise.all([
        readActionResult(getLinkedShifts(reportId)),
        readActionResult(getShiftSuggestions(organizationId, reportId)),
      ]);
      onLinkedShiftsChange(linked as LinkedShift[]);
      onSuggestionsChange(nextSuggestions);
    } catch (error) {
      console.error(error);
      setFailure({ scope, cause: error });
      onError(getActionErrorMessage(error, 'シフトの紐付けに失敗しました'));
    }
  };

  const handleUnlink = async (shiftId: string) => {
    if (disabled || !organizationId || !reportId) return;
    setFailure(null);
    try {
      await readActionResult(removeShiftLink(organizationId, reportId, shiftId));
      onLinkedShiftsChange((await readActionResult(getLinkedShifts(reportId))) as LinkedShift[]);
    } catch (error) {
      console.error(error);
      setFailure({ scope, cause: error });
      onError(getActionErrorMessage(error, 'シフトの解除に失敗しました'));
    }
  };

  return (
    <>
      {error != null && <Alert severity="error" action={needsActionRecovery(error) ? <RecoveryLogoutButton /> : undefined}>{getActionErrorMessage(error)}</Alert>}
      {suggestions.filter((suggestion) => !dismissedSuggestions.has(suggestion.id)).map((suggestion) => (
        <Alert
          key={suggestion.id}
          severity="warning"
          sx={{ mb: 1 }}
          action={(
            <Box display="flex" gap={1}>
              <Button disabled={disabled} size="small" onClick={() => void handleLink(suggestion.id)}>紐付ける</Button>
              <Button disabled={disabled} size="small" onClick={() => onDismiss(suggestion.id)}>無視する</Button>
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
                  onDelete={disabled || link.is_primary ? undefined : () => void handleUnlink(link.shift_id)}
                />
              );
            })}
          </Box>
        </Box>
      )}
    </>
  );
}
