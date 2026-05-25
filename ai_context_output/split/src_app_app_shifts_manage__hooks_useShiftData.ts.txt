'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
    getShifts, createShift, updateShift, toggleCancelShift, updateShiftTimeOnly, deleteShiftCompletely
} from '@/app/actions/shift';
import { getShiftPatterns, createShiftPattern, deleteShiftPattern, updateShiftPattern } from '@/app/actions/shiftGeneration';
import { StaffData, FetchedPatternData, ShiftPayload, ShiftPatternPayload } from '@/types';
import { FetchedShiftData } from '@/utils/shiftHelper';
import { Workspace } from '@/context/WorkspaceContext';
import { EventDropArg } from '@fullcalendar/core';
import { EventResizeDoneArg } from '@fullcalendar/interaction';
import { useClients } from '@/hooks/useClients';
import FullCalendar from '@fullcalendar/react';

export function useShiftData(
    currentOrg: Workspace | null,
    currentUserId: string,
    calendarRef: React.RefObject<FullCalendar | null>,
    showToast: (msg: string, severity?: 'success' | 'error' | 'info' | 'warning') => void,
    setSyncProgress: React.Dispatch<React.SetStateAction<{ total: number; current: number; currentName: string } | null>>,
    setUnsyncedCount: React.Dispatch<React.SetStateAction<number>>
) {
    const [initialLoading, setInitialLoading] = useState(true);
    const [isFetching, setIsFetching] = useState(false);
    const [rawShifts, setRawShifts] = useState<FetchedShiftData[]>([]);
    const [patterns, setPatterns] = useState<FetchedPatternData[]>([]);
    const { clients } = useClients(currentOrg?.id);
    const [staffs, setStaffs] = useState<StaffData[]>([]);
    const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);

    const fetchMasterData = useCallback(async () => {
        if (!currentOrg) return;
        try {
            const { data: s } = await supabase.from('staffs').select('id, name, user_id').eq('organization_id', currentOrg.id);
            if (s) {
                const parsed = s.map(item => ({ id: item.id, name: item.name, type: item.user_id ? 'member' as const : 'ghost' as const }));
                setStaffs(parsed);

                if (currentUserId) {
                    const me = parsed.find(item => s.find(sd => sd.id === item.id)?.user_id === currentUserId);
                    if (me) setCurrentStaffId(me.id);
                }
            }
        } catch (error) {
            console.error(error);
        }
    }, [currentOrg, currentUserId]);

    const fetchData = useCallback(async (isBackground = false) => {
        if (!currentOrg) return;
        if (!isBackground) setInitialLoading(true);
        setIsFetching(true);

        const calendarApi = calendarRef.current?.getApi();
        const currentCalendarDate = calendarApi?.getDate();

        try {
            const fetchedPatterns = await getShiftPatterns(currentOrg.id);
            setPatterns((fetchedPatterns as unknown as FetchedPatternData[]) || []);

            const start = new Date(); start.setDate(start.getDate() - 45);
            const end = new Date(); end.setDate(end.getDate() + 45);
            
            const fetchedShifts = await getShifts(currentOrg.id, start.toISOString(), end.toISOString());
            const typedShifts = (fetchedShifts as unknown as FetchedShiftData[]) || [];

            typedShifts.sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());

            setRawShifts(typedShifts);

            const { count: unsyncedCountResult } = await supabase
                .from('shifts')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', currentOrg.id)
                .is('google_event_id', null);
            setUnsyncedCount(unsyncedCountResult || 0);

            if (calendarApi && currentCalendarDate) {
                setTimeout(() => {
                    calendarApi.gotoDate(currentCalendarDate);
                }, 10);
            }
        } catch (error) {
            console.error(error);
            showToast('データの取得に失敗しました', 'error');
        } finally {
            setInitialLoading(false);
            setIsFetching(false);
        }
    }, [currentOrg, calendarRef, setUnsyncedCount, showToast]);

    const handleSaveShift = useCallback(async (payload: ShiftPayload, shiftId?: string) => {
        setSyncProgress({ total: 1, current: 0, currentName: shiftId ? 'Googleカレンダーの予定を更新中...' : 'Googleカレンダーへ新規登録中...' });
        try {
            if (shiftId) await updateShift(shiftId, payload);
            else await createShift(payload);
            showToast('シフト情報を保存しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    }, [fetchData, showToast, setSyncProgress]);

    const handleToggleCancel = useCallback(async (shiftId: string, isCancel: boolean, reason: string) => {
        setSyncProgress({ total: 1, current: 0, currentName: isCancel ? '予定をお休みに設定＆Google同期中...' : '予定を通常復元＆Google同期中...' });
        try {
            await toggleCancelShift(shiftId, isCancel, reason);
            showToast(isCancel ? 'シフトをお休みに設定しました' : '通常予定に復元しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('変更に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    }, [fetchData, showToast, setSyncProgress]);

    const handleDeleteShift = useCallback(async (shiftId: string) => {
        setSyncProgress({ total: 1, current: 0, currentName: 'Googleカレンダーから予定を削除中...' });
        try {
            await deleteShiftCompletely(shiftId);
            showToast('シフトを完全に削除しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('削除に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    }, [fetchData, showToast, setSyncProgress]);

    const handleEventChange = useCallback(async (info: EventDropArg | EventResizeDoneArg) => {
        const shiftId = info.event.extendedProps.shiftId;
        const start = info.event.start?.toISOString() || '';
        const end = info.event.end ? info.event.end.toISOString() : new Date(info.event.start!.getTime() + 3600000).toISOString();

        setSyncProgress({ total: 1, current: 0, currentName: '予定時間を更新＆Google同期中...' });
        try {
            await updateShiftTimeOnly(shiftId, start, end);
            showToast('シフト時間を調整しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            info.revert();
            showToast('変更に失敗しました', 'error');
        } finally {
            setSyncProgress(null);
        }
    }, [fetchData, showToast, setSyncProgress]);

    const handleSavePattern = useCallback(async (payload: ShiftPatternPayload, patternId?: string) => {
        try {
            if (patternId) {
                await updateShiftPattern(patternId, payload);
                showToast('ひな形情報を更新しました');
            } else {
                await createShiftPattern(payload);
                showToast('新規ひな形を登録しました');
            }
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('保存に失敗しました', 'error');
        }
    }, [fetchData, showToast]);

    const handleDeletePattern = useCallback(async (id: string) => {
        if (!confirm('このひな形を削除しますか？\n（※すでに展開済みのカレンダー上のシフト実体は削除されません）')) return;
        try {
            await deleteShiftPattern(id);
            showToast('ひな形を削除しました');
            fetchData(true);
        } catch (error) {
            console.error(error);
            showToast('削除に失敗しました', 'error');
        }
    }, [fetchData, showToast]);

    useEffect(() => {
        if (currentOrg) {
            fetchMasterData();
            fetchData();
        }
    }, [currentOrg, fetchMasterData, fetchData]);

    return {
        initialLoading,
        isFetching,
        rawShifts,
        patterns,
        clients,
        staffs,
        currentStaffId,
        fetchData,
        handleSaveShift,
        handleToggleCancel,
        handleDeleteShift,
        handleEventChange,
        handleSavePattern,
        handleDeletePattern
    };
}