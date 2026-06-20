'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Box, CircularProgress } from '@/components/ui/mui';

export default function JoinPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const code = searchParams.get('code');

    useEffect(() => {
        const check = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            
            // 遷移先URL (セットアップ画面へコードを渡す)
            const targetUrl = `/setup?inviteCode=${code || ''}`;

            if (session) {
                // ログイン済み -> Setup画面（参加フロー）へ
                router.replace(targetUrl);
            } else {
                // 未ログイン -> ログイン画面へ（ログイン後にSetup画面へ飛ぶようにパラメータ付与）
                router.replace(`/?next=${encodeURIComponent(targetUrl)}`);
            }
        };
        check();
    }, [code, router]);

    return (
        <Box height="100vh" display="flex" justifyContent="center" alignItems="center">
            <CircularProgress />
        </Box>
    );
}