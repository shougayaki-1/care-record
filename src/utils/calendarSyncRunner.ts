import { googleSyncErrorMessage } from './googleSync';
import type { repairGoogleCalendarSync, syncUnsyncedBatch } from '@/app/actions/shift';

type ActionData<T> = T extends { ok: true; data: infer D } ? D : never;
export type RepairResult = ActionData<Awaited<ReturnType<typeof repairGoogleCalendarSync>>>;
type BatchResult = Pick<ActionData<Awaited<ReturnType<typeof syncUnsyncedBatch>>>,
    'processed' | 'succeeded' | 'failed' | 'remaining' | 'errorKind'>;
export type SyncSummary = { succeeded: number; failed: number; errorKind?: string };

/** One item per request, matching both screens' existing progress and stop rules. */
export async function runCalendarSyncBatches({ total, batch, onProgress, isActive }: {
    total: number;
    batch: () => Promise<BatchResult>;
    onProgress: (current: number) => void;
    isActive: () => boolean;
}): Promise<SyncSummary> {
    const summary: SyncSummary = { succeeded: 0, failed: 0 };
    let processed = 0;
    while (total > 0 && isActive()) {
        const result = await batch();
        if (!isActive()) break;
        summary.succeeded += result.succeeded;
        summary.failed += result.failed;
        processed += result.processed;
        if (result.errorKind) summary.errorKind = result.errorKind;
        onProgress(Math.min(total, processed));
        if (summary.errorKind === 'auth' || result.remaining <= 0 || result.succeeded === 0 || result.processed === 0) break;
    }
    return summary;
}

export function syncResultNotice(result: SyncSummary, retryMessage: string) {
    const message = googleSyncErrorMessage(result.errorKind);
    if (message) return { message, severity: 'warning' as const };
    if (result.failed > 0) return {
        message: `同期が一部失敗しました（成功 ${result.succeeded} 件 / 失敗 ${result.failed} 件）。通信状況を確認し、しばらくしてから${retryMessage}`,
        severity: 'warning' as const,
    };
    return { message: `Googleカレンダーへの同期が完了しました（${result.succeeded} 件）。`, severity: 'success' as const };
}

export function repairResultNotice(result: RepairResult, disconnectedMessage: string) {
    if (!result.connected) return { message: disconnectedMessage, severity: 'warning' as const };
    if (result.errorKind) return { message: googleSyncErrorMessage(result.errorKind)!, severity: 'warning' as const };
    if (result.failed > 0) return { message: `同期修復が一部失敗しました（成功 ${result.succeeded} 件 / 失敗 ${result.failed} 件）。`, severity: 'warning' as const };
    return {
        message: `同期修復が完了しました（作成 ${result.created} / 更新 ${result.updated} / 再リンク ${result.linked} / 重複削除 ${result.deduped} / Google削除 ${result.deletedRemote}）。`,
        severity: 'success' as const,
    };
}
