import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';
import type { EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { createShift, updateShift, toggleCancelShift, deleteShift, updateShiftTimeOnly,
    createShiftPattern, updateShiftPattern, deleteShiftPattern,
    type ShiftPayload, type ShiftPatternPayload } from '@/app/actions/shift';
import type { ShiftEditingOptions } from '@/features/shifts/manageTypes';

/** Modal callbacks propagate failures; calendar mutations revert their optimistic change. */
export function useShiftEditing({ mastersReady, showToast, onRefresh, confirm, setSyncProgress }: ShiftEditingOptions) {
    const handleSaveShift = async (payload: ShiftPayload, shiftId?: string) => {
        if (!mastersReady) throw new Error('利用者・スタッフ情報を再取得してください。');
        setSyncProgress({ total: 1, current: 0, currentName: shiftId ? 'Googleカレンダーの予定を更新中...' : 'Googleカレンダーへ新規登録中...' });
        try {
            if (shiftId) await readActionResult(updateShift(shiftId, payload));
            else await readActionResult(createShift(payload));
            showToast('シフト情報を保存しました');
            onRefresh();
        } finally {
            setSyncProgress(null);
        }
    };

    const handleToggleCancel = async (shiftId: string, isCancel: boolean, reason: string) => {
        setSyncProgress({ total: 1, current: 0, currentName: isCancel ? '予定をお休みに設定＆Google同期中...' : '予定を通常復元＆Google同期中...' });
        try {
            await readActionResult(toggleCancelShift(shiftId, isCancel, reason));
            showToast(isCancel ? 'シフトをお休みに設定しました' : '通常予定に復元しました');
            onRefresh();
        } finally {
            setSyncProgress(null);
        }
    };

    const handleDeleteShift = async (shiftId: string) => {
        setSyncProgress({ total: 1, current: 0, currentName: 'シフトを削除・Googleカレンダーに反映中...' });
        try {
            const result = await readActionResult(deleteShift(shiftId));
            showToast(result.failed > 0
                ? 'シフトを削除しました。Googleカレンダーへの反映に失敗しました。連携を確認して同期修復を実行してください。'
                : 'シフトを削除しました', result.failed > 0 ? 'warning' : 'success');
            onRefresh();
        } catch (error) {
            console.error(error);
            // モーダルで安全な業務エラーを表示し、失敗時は編集画面を維持する。
            throw error;
        } finally {
            setSyncProgress(null);
        }
    };

    const handleEventChange = async (info: EventDropArg | EventResizeDoneArg) => {
        if (!mastersReady) {
            info.revert();
            showToast('利用者・スタッフ情報を再取得してください。', 'error');
            return;
        }
        const shiftId = info.event.extendedProps.shiftId;
        const start = info.event.start?.toISOString() || '';
        const end = info.event.end ? info.event.end.toISOString() : new Date(info.event.start!.getTime() + 3600000).toISOString();

        setSyncProgress({ total: 1, current: 0, currentName: '予定時間を更新＆Google同期中...' });
        try {
            await readActionResult(updateShiftTimeOnly(shiftId, start, end));
            showToast('シフト時間を調整しました');
            onRefresh();
        } catch (error) {
            console.error(error);
            info.revert();
            showToast('変更に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    };

    const handleSavePattern = async (payload: ShiftPatternPayload, patternId?: string) => {
        if (!mastersReady) throw new Error('利用者・スタッフ情報を再取得してください。');
        if (patternId) {
            await readActionResult(updateShiftPattern(patternId, payload));
            showToast('ひな形情報を更新しました');
        } else {
            await readActionResult(createShiftPattern(payload));
            showToast('新規ひな形を登録しました');
        }
        onRefresh();
    };

    const handleDeletePattern = async (id: string) => {
        if (!(await confirm({ title: 'ひな形の削除', message: 'このひな形を削除しますか？\n（※すでに展開済みのカレンダー上のシフト実体は削除されません）', confirmText: '削除する', confirmColor: 'error' }))) return;
        try {
            await readActionResult(deleteShiftPattern(id));
            showToast('ひな形を削除しました');
            onRefresh();
        } catch (error) {
            console.error(error);
            showToast(getActionErrorMessage(error, '削除に失敗しました'), 'error');
        }
    };

    return { handleSaveShift, handleToggleCancel, handleDeleteShift, handleEventChange, handleSavePattern, handleDeletePattern };
}
