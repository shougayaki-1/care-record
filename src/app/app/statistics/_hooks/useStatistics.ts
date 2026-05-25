'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Workspace } from '@/context/WorkspaceContext';
import { ShiftData, ReportData, AggregatedRow } from '@/types';
import { getOverlappingHours } from '../utils';

export function useStatistics(
    currentOrg: Workspace | null,
    targetMonth: string,
    tabIndex: number,
    showToast: (msg: string, severity?: 'success' | 'error' | 'info') => void
) {
    const [loading, setLoading] = useState(true);
    const [rawShifts, setRawShifts] = useState<ShiftData[]>([]);
    const [rawReports, setRawReports] = useState<ReportData[]>([]);

    const fetchStatisticsData = useCallback(async () => {
        if (!currentOrg || !targetMonth) return;
        setLoading(true);

        try {
            const [yearStr, monthStr] = targetMonth.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthStr, 10) - 1;

            const monthStart = new Date(year, month, 1, 0, 0, 0);
            const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

            const shiftStartRange = new Date(monthStart.getTime() - (24 * 60 * 60 * 1000)).toISOString();
            const shiftEndRange = new Date(monthEnd.getTime() + (24 * 60 * 60 * 1000)).toISOString();

            const [shiftsRes, reportsRes] = await Promise.all([
                supabase
                    .from('shifts')
                    .select(`
                        id, start_at, end_at, status, client_id,
                        clients (name),
                        shift_staffs (staff_id, staffs(name))
                    `)
                    .eq('organization_id', currentOrg.id)
                    .neq('status', 'cancelled')
                    .gte('end_at', shiftStartRange)
                    .lte('start_at', shiftEndRange),
                supabase
                    .from('reports')
                    .select(`
                        id, start_at, end_at, status, client_id,
                        clients (name),
                        helper:profiles!reports_helper_id_fkey (name),
                        report_values (data)
                    `)
                    .eq('clients.organization_id', currentOrg.id)
                    .in('status', ['pending', 'approved']) 
                    .gte('end_at', shiftStartRange)
                    .lte('start_at', shiftEndRange)
            ]);

            if (shiftsRes.error) throw shiftsRes.error;
            if (reportsRes.error) throw reportsRes.error;

            setRawShifts((shiftsRes.data as unknown as ShiftData[]) || []);
            setRawReports((reportsRes.data as unknown as ReportData[]) || []);
        } catch (error) {
            console.error(error);
            showToast('データの取得に失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    }, [currentOrg, targetMonth, showToast]);

    useEffect(() => {
        if (currentOrg) fetchStatisticsData();
    }, [currentOrg, fetchStatisticsData]);

    const aggregatedData = useMemo(() => {
        if (!targetMonth) return [];

        const [yearStr, monthStr] = targetMonth.split('-');
        const monthStart = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1, 0, 0, 0);
        const monthEnd = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0, 23, 59, 59, 999);

        const statsMap: Record<string, AggregatedRow> = {};

        const addHours = (name: string, type: 'planned' | 'actual', hours: number) => {
            if (!name) return;
            if (!statsMap[name]) statsMap[name] = { name, plannedHours: 0, actualHours: 0 };
            if (type === 'planned') statsMap[name].plannedHours += hours;
            else statsMap[name].actualHours += hours;
        };

        rawShifts.forEach(shift => {
            const shiftStart = new Date(shift.start_at);
            const shiftEnd = new Date(shift.end_at);
            const hours = getOverlappingHours(shiftStart, shiftEnd, monthStart, monthEnd);
                
            if (hours > 0) {
                if (tabIndex === 1 && shift.clients?.name) {
                    addHours(shift.clients.name, 'planned', hours);
                }
                if (tabIndex === 0) {
                    if (shift.shift_staffs && shift.shift_staffs.length > 0) {
                        shift.shift_staffs.forEach(staff => {
                            const sName = Array.isArray(staff.staffs) ? staff.staffs[0]?.name : staff.staffs?.name;
                            if (sName) addHours(sName, 'planned', hours);
                            else addHours('未設定(スタッフ名なし)', 'planned', hours);
                        });
                    } else {
                        addHours('未設定(シフト担当者なし)', 'planned', hours);
                    }
                }
            }
        });

        rawReports.forEach(report => {
            let actualHours = 0;
            const dataObj = (report.report_values && report.report_values.length > 0) ? report.report_values[0].data : null;
            
            if (dataObj) {
                const sTime = parseFloat(String(dataObj.service_time || 0)) || 0;
                actualHours = sTime;
            }

            if (actualHours <= 0) {
                const rStart = new Date(report.start_at);
                const rEnd = new Date(report.end_at);
                actualHours = getOverlappingHours(rStart, rEnd, monthStart, monthEnd);
            }

            if (actualHours > 0) {
                if (tabIndex === 1 && report.clients?.name) {
                    addHours(report.clients.name, 'actual', actualHours);
                }
                if (tabIndex === 0) {
                    const actualHelpers = dataObj?._helpers || [];
                    
                    if (Array.isArray(actualHelpers) && actualHelpers.length > 0) {
                        actualHelpers.forEach(helperName => {
                            if (helperName) addHours(String(helperName), 'actual', actualHours);
                        });
                    } else if (report.helper?.name) {
                        const fallbackName = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper.name;
                        if (fallbackName) addHours(fallbackName, 'actual', actualHours);
                    } else {
                        addHours('未設定(担当者不明)', 'actual', actualHours);
                    }
                }
            }
        });

        return Object.values(statsMap).sort((a, b) => a.name.localeCompare(b.name));
    }, [rawShifts, rawReports, targetMonth, tabIndex]);

    return {
        loading,
        aggregatedData,
        refetch: fetchStatisticsData
    };
}