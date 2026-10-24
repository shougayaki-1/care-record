'use client';

import { AppButton } from '@/components/ui';
import { Alert } from '@/components/ui/mui';
import type { ShiftFetchStatus as FetchStatus } from '@/hooks/useShiftData';

type Props = {
    masterStatus: FetchStatus;
    countStatus: FetchStatus;
    showCount: boolean;
    onRetryMaster: () => void;
    onRetryCount: () => void;
};

export function ShiftFetchStatus({ masterStatus, countStatus, showCount, onRetryMaster, onRetryCount }: Props) {
    return <>
        {masterStatus !== 'success' && (
            <Alert severity={masterStatus === 'error' ? 'error' : 'info'} sx={{ mb: 2 }}
                action={masterStatus === 'error' ? <AppButton size="small" intent="secondary" onClick={onRetryMaster}>マスタを再試行</AppButton> : undefined}>
                {masterStatus === 'error'
                    ? '利用者・スタッフ情報を取得できませんでした。シフトの閲覧はできますが、新規作成・編集は再取得後に行ってください。'
                    : '利用者・スタッフ情報を取得中です。新規作成・編集は取得後に行えます。'}
            </Alert>
        )}
        {showCount && countStatus !== 'success' && (
            <Alert severity={countStatus === 'error' ? 'warning' : 'info'} sx={{ mb: 2 }}
                action={countStatus === 'error' ? <AppButton size="small" intent="secondary" onClick={onRetryCount}>未同期件数を再試行</AppButton> : undefined}>
                {countStatus === 'error' ? '未同期件数を取得できませんでした。同期状態は未確認です。' : '未同期件数を確認中です。'}
            </Alert>
        )}
    </>;
}
