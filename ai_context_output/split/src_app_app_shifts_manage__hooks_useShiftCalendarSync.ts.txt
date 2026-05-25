'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { syncSingleShift, repairUnsyncedShifts } from '@/app/actions/shiftCalendar';
import { deleteShiftsDbOnly } from '@/app/actions/shift';
import { generateShiftsForMonth } from '@/app/actions/shiftGeneration';
import { Workspace } from '@/context/WorkspaceContext';
import { FetchedShiftData } from '@/utils/shiftHelper';

export function useShiftCalendarSync(
    currentOrg: Workspace | null,
    syncProgress: { total: number; current: number; currentName: string } | null,
    setSyncProgress: React.Dispatch<React.SetStateAction<{ total: number; current: number; currentName: string } | null>>,
    unsyncedCount: number,
    setUnsyncedCount: React.Dispatch<React.SetStateAction<number>>,
    generating: boolean,
    setGenerating: React.Dispatch<React.SetStateAction<boolean>>,
    showToast: (msg: string, severity?: 'success' | 'error' | 'info' | 'warning') => void,
    fetchData: (isBackground?: boolean) => Promise<void>
) {
    // 親へリフトアップされた状態以外の、このモジュール固有のローカルステートのみを定義
    const [repairingFromBanner, setRepairingFromBanner] = useState(false);
    const [resyncingCal, setResyncingCal] = useState(false);

    const runBackgroundSync = useCallback(async (unsyncedShifts: { id: string; title: string | null }[]) => {
        if (!currentOrg) return;

        setSyncProgress({ total: unsyncedShifts.length, current: 0, currentName: '同期を開始しています...' });
        let currentCount = 0;

        const preventTabClose = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Googleカレンダーとの同期が進行中です。';
        };
        window.addEventListener('beforeunload', preventTabClose);

        try {
            for (const shift of unsyncedShifts) {
                setSyncProgress({
                    total: unsyncedShifts.length,
                    current: currentCount,
                    currentName: `${shift.title || '予定'}`
                });

                await syncSingleShift(currentOrg.id, shift.id);
                currentCount++;
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            setSyncProgress(null);
            showToast('Googleカレンダーへの同期が正常に完了しました！', 'success');
            
            const { count: finalUnsynced } = await supabase
                .from('shifts')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', currentOrg.id)
                .is('google_event_id', null);
            setUnsyncedCount(finalUnsynced || 0);

        } catch (error) {
            console.error('Background Sync Error:', error);
            showToast('バックグラウンドでの同期処理中に一部エラーが発生しました。', 'warning');
            setSyncProgress(null);
        } finally {
            window.removeEventListener('beforeunload', preventTabClose);
        }
    }, [currentOrg, showToast, setSyncProgress, setUnsyncedCount]);

    const handleRepairFromBanner = useCallback(async () => {
        if (!currentOrg) return;
        setRepairingFromBanner(true);
        setSyncProgress({ total: unsyncedCount, current: 0, currentName: '同期修復を開始しています...' });
        try {
            const res = await repairUnsyncedShifts(currentOrg.id);
            showToast(`カレンダー同期を修復しました。（修復されたシフト数: ${res.count} 件）`, 'success');
            fetchData(true);
        } catch (e) {
            console.error(e);
            showToast('同期修復に失敗しました。接続設定を確認してください。', 'error');
        } finally {
            setRepairingFromBanner(false);
            setSyncProgress(null);
        }
    }, [currentOrg, unsyncedCount, fetchData, showToast, setSyncProgress]);

    const executeGenerate = useCallback(async (targetMonth: string, setTabIndex: (idx: number) => void) => {
        if (!currentOrg) return;
        setGenerating(true);

        try {
            const res = await generateShiftsForMonth(currentOrg.id, targetMonth);
            setGenerating(false);
            setTabIndex(1);
            showToast(`${targetMonth}月のシフト ${res.count} 件の生成が完了しました！カレンダーへの同期をバックグラウンドで開始します。`, 'success');

            await fetchData(true);

            const { data: unsyncedShifts, error: queryError } = await supabase
                .from('shifts')
                .select('id, title')
                .eq('organization_id', currentOrg.id)
                .is('google_event_id', null);

            if (queryError) throw queryError;

            if (unsyncedShifts && unsyncedShifts.length > 0) {
                await runBackgroundSync(unsyncedShifts);
            }
        } catch (error) {
            console.error(error);
            showToast('自動展開またはカレンダーとの同期に失敗しました', 'error');
            setGenerating(false);
        }
    }, [currentOrg, fetchData, runBackgroundSync, showToast, setGenerating]);

    const executeClearMonthShifts = useCallback(async (targetMonth: string, clearMode: 'unmodified' | 'all') => {
        if (!currentOrg) return;
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
                .not('pattern_id', 'is', null)
                .or(`and(start_at.gte.${startDateISO},start_at.lte.${endDateISO})`);

            if (clearMode === 'unmodified') {
                query = query.eq('is_modified', false);
            }

            const { data: targetShifts, error: queryError } = await query;
            if (queryError) throw queryError;

            if (!targetShifts || targetShifts.length === 0) {
                showToast(`${targetMonth}月に消去対象の予定はありませんでした。`, 'info');
                setGenerating(false);
                return;
            }

            setGenerating(false);
            setSyncProgress({ total: targetShifts.length, current: 0, currentName: '一括消去の同期処理を開始中...' });

            const preventTabClose = (e: BeforeUnloadEvent) => {
                e.preventDefault();
                e.returnValue = '一括消去が進行中です。ページを閉じると同期が途中で中断されます。';
            };
            window.addEventListener('beforeunload', preventTabClose);

            let currentCount = 0;
            const shiftIds = targetShifts.map(s => s.id);

            for (const shift of targetShifts) {
                setSyncProgress({
                    total: targetShifts.length,
                    current: currentCount,
                    currentName: `Googleから削除中: ${shift.title || '予定'}`
                });

                await syncSingleShift(currentOrg.id, shift.id, 'delete');
                currentCount++;
                await new Promise(resolve => setTimeout(resolve, 250));
            }

            setSyncProgress({ total: targetShifts.length, current: targetShifts.length, currentName: 'DBから一括消去中...' });
            await deleteShiftsDbOnly(shiftIds);

            setSyncProgress(null);
            window.removeEventListener('beforeunload', preventTabClose);

            showToast(`${targetMonth}月のシフトを ${targetShifts.length} 件、Googleカレンダーを含めて完全に消去しました。`, 'success');
            fetchData(true);

        } catch (error) {
            console.error('Clear Deployed Shifts Error:', error);
            showToast('消去処理、またはカレンダーとの同期に失敗しました。', 'error');
            setGenerating(false);
            setSyncProgress(null);
        }
    }, [currentOrg, fetchData, showToast, setGenerating, setSyncProgress]);

    const handleForceResyncCalendar = useCallback(async (rawShifts: FetchedShiftData[]) => {
        if (!currentOrg || rawShifts.length === 0) return;
        if (!confirm(`カレンダーに登録・表示されているすべての予定 (${rawShifts.length} 件) をGoogleカレンダーへ強制的に再同期します。よろしいですか？`)) return;

        setResyncingCal(true);
        setSyncProgress({ total: rawShifts.length, current: 0, currentName: '同期の準備中...' });

        const preventTabClose = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Googleカレンダーへの全件強制再同期が進行中です。';
        };
        window.addEventListener('beforeunload', preventTabClose);

        try {
            let successCount = 0;
            for (const shift of rawShifts) {
                setSyncProgress({
                    total: rawShifts.length,
                    current: successCount,
                    currentName: `強制同期中: ${shift.title || '予定'}`
                });

                await syncSingleShift(currentOrg.id, shift.id);
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            showToast(`全件の強制再同期が完了しました。（同期されたシフト数: ${successCount} 件）`, 'success');
            fetchData(true);
        } catch (e) {
            console.error('Force Resync Error:', e);
            showToast('再同期処理中にエラーが発生しました。カレンダーの連携状態を確認してください。', 'error');
        } finally {
            setResyncingCal(false);
            setSyncProgress(null);
            window.removeEventListener('beforeunload', preventTabClose);
        }
    }, [currentOrg, fetchData, showToast, setSyncProgress]);

    return {
        unsyncedCount,
        generating,
        repairingFromBanner, // 状態変数を戻り値に正しく追加
        resyncingCal,        // 状態変数を戻り値に正しく追加
        handleRepairFromBanner,
        executeGenerate,
        executeClearMonthShifts,
        handleForceResyncCalendar
    };
}