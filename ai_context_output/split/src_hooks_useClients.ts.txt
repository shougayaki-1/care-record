'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ClientData } from '@/types';

/**
 * 事業所所属の利用者（クライアント）一覧を取得・管理するカスタムフック
 */
export function useClients(orgId: string | undefined, includeArchived = false) {
    const [clients, setClients] = useState<ClientData[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchClients = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setError(null);
        try {
            let query = supabase
                .from('clients')
                .select('id, name, archived_at, google_template_id, google_folder_id')
                .eq('organization_id', orgId);

            if (!includeArchived) {
                query = query.is('archived_at', null);
            }

            const { data, error: fetchErr } = await query.order('created_at', { ascending: false });
            if (fetchErr) throw fetchErr;

            setClients((data as ClientData[]) || []);
        } catch (err) {
            console.error('useClients Error:', err);
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [orgId, includeArchived]);

    useEffect(() => {
        fetchClients();
    }, [fetchClients]);

    return { clients, loading, error, refetch: fetchClients };
}