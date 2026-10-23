import { useState } from 'react';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';
import { generateShiftsForMonth, previewShiftsForMonth, deleteShiftsBatch } from '@/app/actions/shift';
import { supabase } from '@/lib/supabase';
import type { ShiftOperationFeedback } from '@/features/shifts/manageTypes';
import type { SyncProgress } from '@/hooks/useCalendarSync';

export type ShiftMonthPreview = Extract<Awaited<ReturnType<typeof previewShiftsForMonth>>, { ok: true }>['data'];
export type ShiftClearMode = 'unmodified' | 'all';

type Options = ShiftOperationFeedback & {
    currentOrg: { id: string } | null;
    targetMonth: string;
    mastersReady: boolean;
    onGenerated: () => void;
    runUnsyncedSyncLoop: () => Promise<boolean>;
};

/** Preview is read-only. Only the confirmation callback creates the month's shifts. */
export function useShiftMonthOperations({ currentOrg, targetMonth, mastersReady, showToast, onRefresh, onGenerated, runUnsyncedSyncLoop }: Options) {
    const [generating, setGenerating] = useState(false);
    const [clearDialogOpen, setClearDialogOpen] = useState(false);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
    const [clearMode, setClearMode] = useState<ShiftClearMode>('unmodified');
    const [previewDetails, setPreviewDetails] = useState<ShiftMonthPreview | null>(null);
    const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);

    const handleCalculatePreview = async () => {
        if (!currentOrg) return;
        setGenerating(true);
        try {
            const res = await readActionResult(previewShiftsForMonth(currentOrg.id, targetMonth));
            setPreviewDetails(res);
            setPreviewDialogOpen(true);
        } catch (e) {
            console.error(e);
            showToast(getActionErrorMessage(e, '計算処理に失敗しました'), 'error');
        } finally {
            setGenerating(false);
        }
    };

    const executeGenerate = async () => {
        if (!currentOrg || !mastersReady) return;
        setPreviewDialogOpen(false);
        setGenerating(true);
        try {
            const res = await readActionResult(generateShiftsForMonth(currentOrg.id, targetMonth));
            setGenerating(false);
            onGenerated();
            const resultSummary = `新規${res.count}件 / 更新${res.updated}件 / 編集済みスキップ${res.skipped}件 / 失敗${res.failed}件`;
            if (res.failed > 0) {
                showToast(
                    `${resultSummary}。ひな形が削除済みのスタッフ・サービス種別を参照している可能性があります。`,
                    'warning',
                );
            } else {
                showToast(`${resultSummary}。続けてGoogleカレンダーへ同期します。`, 'success');
            }
            onRefresh();
            await runUnsyncedSyncLoop();
            onRefresh();
        } catch (error) {
            console.error(error);
            showToast(getActionErrorMessage(error, 'シフトの自動展開に失敗しました。'), 'error');
            setGenerating(false);
        }
    };

    const executeClearMonthShifts = async () => {
        if (!currentOrg) return;
        setClearDialogOpen(false);
        setGenerating(true);

        try {
            const [year, month] = targetMonth.split('-').map(Number);
            const lastDayNum = new Date(year, month, 0).getDate();
            const pad = (n: number) => String(n).padStart(2, '0');
            const startDateISO = new Date(`${year}-${pad(month)}-01T00:00:00+09:00`).toISOString();
            const endDateISO = new Date(`${year}-${pad(month)}-${pad(lastDayNum)}T23:59:59+09:00`).toISOString();

            let query = supabase.from('shifts')
                .select('id, title')
                .eq('organization_id', currentOrg.id)
                .is('deleted_at', null)
                .not('pattern_id', 'is', null)
                .or(`and(start_at.gte.${startDateISO},start_at.lte.${endDateISO})`);
            if (clearMode === 'unmodified') query = query.eq('is_modified', false);

            const { data: targetShifts, error: queryError } = await query;
            if (queryError) throw queryError;

            if (!targetShifts || targetShifts.length === 0) {
                showToast(`${targetMonth}月に消去対象の予定はありませんでした。`, 'info');
                setGenerating(false);
                return;
            }

            setGenerating(false);
            const total = targetShifts.length;
            setSyncProgress({ total, current: 0, currentName: '一括消去を開始中...' });

            const shiftIds = targetShifts.map(s => s.id);
            const CHUNK = 20;
            let deleted = 0, failed = 0;

            for (let i = 0; i < shiftIds.length; i += CHUNK) {
                const chunk = shiftIds.slice(i, i + CHUNK);
                const res = await readActionResult(deleteShiftsBatch(currentOrg.id, chunk));
                deleted += res.deleted;
                failed += res.failed;
                setSyncProgress({ total, current: Math.min(total, deleted), currentName: `${Math.min(total, deleted)} / ${total} 件 処理済み` });
            }

            setSyncProgress(null);

            if (failed > 0) {
                showToast(`${deleted} 件を削除しました。${failed} 件はGoogleカレンダーへの反映に失敗しました。連携を確認して同期修復を実行してください。`, 'warning');
            } else {
                showToast(`${targetMonth}月のシフトを ${deleted} 件削除しました。`, 'success');
            }
            onRefresh();
        } catch (error) {
            console.error('Clear Deployed Shifts Error:', error);
            showToast(getActionErrorMessage(error, '消去処理中にエラーが発生しました。'), 'error');
            setGenerating(false);
            setSyncProgress(null);
        }
    };

    return {
        generating, syncProgress, clearDialogOpen, previewDialogOpen, clearMode, previewDetails,
        setClearMode, closeClear: () => setClearDialogOpen(false), closePreview: () => setPreviewDialogOpen(false),
        openClear: () => { setClearMode('unmodified'); setClearDialogOpen(true); },
        handleCalculatePreview, executeGenerate, executeClearMonthShifts,
    };
}
