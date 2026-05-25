'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface OrgMember {
    userId: string;
    role: string;
    name: string;
    email?: string;
}

/**
 * 組織メンバーのアカウントと、割り当てられたシステム権限（ロール）情報を取得・管理するカスタムフック
 */
export function useOrgMembers(orgId: string | undefined) {
    const [members, setMembers] = useState<OrgMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchMembers = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        setError(null);
        try {
            // 組織に登録されているメンバーを一次取得
            const { data: membersData, error: membersErr } = await supabase
                .from('organization_members')
                .select('user_id, role')
                .eq('organization_id', orgId);

            if (membersErr) throw membersErr;

            if (!membersData || membersData.length === 0) {
                setMembers([]);
                return;
            }

            const userIds = membersData.map(m => m.user_id);

            // メンバーの認証プロフィール情報（氏名、メールアドレス）を二次取得
            const { data: profilesData, error: profilesErr } = await supabase
                .from('profiles')
                .select('id, name, email')
                .in('id', userIds);

            if (profilesErr) throw profilesErr;

            const profilesMap = new Map(profilesData?.map(p => [p.id, p]));

            const formattedMembers: OrgMember[] = membersData.map(m => {
                const profile = profilesMap.get(m.user_id);
                return {
                    userId: m.user_id,
                    role: m.role,
                    name: profile?.name || '名前未設定',
                    email: profile?.email
                };
            });

            setMembers(formattedMembers);
        } catch (err) {
            console.error('useOrgMembers Error:', err);
            setError(err as Error);
        } finally {
            setLoading(false);
        }
    }, [orgId]);

    useEffect(() => {
        fetchMembers();
    }, [fetchMembers]);

    return { members, loading, error, refetch: fetchMembers };
}