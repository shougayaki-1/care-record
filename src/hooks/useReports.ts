'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Report } from '@/utils/reportExportHelper';

export interface ReportFilters {
    clientId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    onlyPending?: boolean;
}

/**
 * 承認・未承認などのフィルタ条件に基づいて、提供記録（報告書）の一覧を取得・管理するカスタムフック
 */
export function useReports(orgId: string | undefined, filters?: ReportFilters) {
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchReports = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setError(null);
        try {
            let query = supabase
                .from('reports')
                .select(`
                    *, clients!inner ( id, name, organization_id ),
                    helper:profiles!reports_helper_id_fkey ( name ),
                    approved_by_user:profiles!reports_approved_by_fkey ( name ),
                    report_values ( data )
                `)
                .eq('clients.organization_id', orgId)
                .neq('status', 'draft');

            if (filters) {
                if (filters.clientId && filters.clientId !== 'all') {
                    query = query.eq('client_id', filters.clientId);
                }
                if (filters.startDate) {
                    query = query.gte('start_at', `${filters.startDate}T00:00:00`);
                }
                if (filters.endDate) {
                    query = query.lte('end_at', `${filters.endDate}T23:59:59`);
                }
                if (filters.onlyPending) {
                    query = query.in('status', ['pending', 'remanded']);
                } else if (filters.status && filters.status !== 'all') {
                    query = query.eq('status', filters.status);
                }
            }

            const { data, error: fetchErr } = await query;
            if (fetchErr) throw fetchErr;

            setReports((data as unknown as Report[]) || []);
        } catch (err) {
            console.error('useReports Error:', err);
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [orgId, JSON.stringify(filters)]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    return { reports, setReports, loading, error, refetch: fetchReports };
}