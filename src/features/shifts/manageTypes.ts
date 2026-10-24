import type { useToast } from '@/components/ui/ToastProvider';
import type { useConfirm } from '@/components/ui/ConfirmProvider';
import type { SyncProgress } from '@/hooks/useCalendarSync';

export type ShiftManageTab = 'patterns' | 'fullCalendar' | 'myShift' | 'byStaff' | 'byClient';
export type ShiftOperationFeedback = {
    showToast: ReturnType<typeof useToast>['showToast'];
    onRefresh: () => void;
};
export type ShiftEditingOptions = ShiftOperationFeedback & {
    mastersReady: boolean;
    confirm: ReturnType<typeof useConfirm>;
    setSyncProgress: (progress: SyncProgress | null) => void;
};
