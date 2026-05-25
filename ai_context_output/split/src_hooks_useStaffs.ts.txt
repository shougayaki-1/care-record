'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { StaffData } from '@/types';

interface StaffQueryResult {
    id: string;
    name: string;
    user_id: string | null;
    profiles: { name: string } | { name: string }[] | null;
}

export function useStaffs(orgId: string | undefined) {
    const [staffs, setStaffs] = useState<StaffData[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchStaffs = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchErr } = await supabase
                .from('staffs')
                .select(`
                    id, 
                    name, 
                    user_id, 
                    profiles ( name )
                `)
                .eq('organization_id', orgId)
                .order('name', { ascending: true });

            if (fetchErr) throw fetchErr;

            const formattedStaffs: StaffData[] = (data as unknown as StaffQueryResult[] || []).map((s) => {
                return {
                    id: s.id,
                    name: s.name,
                    type: s.user_id ? 'member' : 'ghost'
                };
            });

            setStaffs(formattedStaffs);
        } catch (err) {
            console.error('useStaffs Error:', err);
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => {
        fetchStaffs();
    }, [fetchStaffs]);

    return { staffs, loading, error, refetch: fetchStaffs };
}