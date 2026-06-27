'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getInvitationPreview, type InvitationPreview } from '@/app/actions/accounts';
import {
    Box, Typography, Paper, Stack, CircularProgress, Chip, Divider,
} from '@/components/ui/mui';
import BusinessIcon from '@mui/icons-material/Business';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import LoginIcon from '@mui/icons-material/Login';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { AppButton } from '@/components/ui';

type State = 'loading' | 'preview' | 'invalid' | 'redirecting';

export default function JoinPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const code = searchParams.get('code') ?? '';

    const [state, setState] = useState<State>('loading');
    const [preview, setPreview] = useState<InvitationPreview | null>(null);

    useEffect(() => {
        if (!code) {
            setState('invalid');
            return;
        }

        const init = async () => {
            // 招待プレビューとセッションチェックを並行実行
            const [previewResult, { data: { session } }] = await Promise.all([
                getInvitationPreview(code),
                supabase.auth.getSession(),
            ]);

            if (session) {
                // ログイン済みならセットアップ画面へ直接
                setState('redirecting');
                router.replace(`/setup?inviteCode=${encodeURIComponent(code)}`);
                return;
            }

            setPreview(previewResult);
            setState(previewResult.valid ? 'preview' : 'invalid');
        };

        init();
    }, [code, router]);

    const loginUrl = `/?next=${encodeURIComponent(`/setup?inviteCode=${code}`)}`;
    const registerUrl = `/?register=1&next=${encodeURIComponent(`/setup?inviteCode=${code}`)}`;

    if (state === 'loading' || state === 'redirecting') {
        return (
            <Box height="100vh" display="flex" justifyContent="center" alignItems="center">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'background.default',
                p: 2,
            }}
        >
            <Paper
                variant="outlined"
                sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 440, borderRadius: 3 }}
            >
                {state === 'invalid' ? (
                    <Stack spacing={2} alignItems="center" textAlign="center">
                        <Box sx={{ p: 1.5, bgcolor: 'error.light', borderRadius: '50%', color: 'error.contrastText' }}>
                            <ErrorOutlineIcon fontSize="large" />
                        </Box>
                        <Typography variant="h6" fontWeight="bold">招待リンクが無効です</Typography>
                        <Typography variant="body2" color="text.secondary">
                            このリンクは有効期限切れか、すでに使用済みです。<br />
                            招待した管理者に新しいリンクを発行してもらってください。
                        </Typography>
                        <AppButton variant="text" intent="secondary" onClick={() => router.push('/')}>
                            ログインページへ
                        </AppButton>
                    </Stack>
                ) : (
                    <Stack spacing={3}>
                        {/* ヘッダー */}
                        <Stack spacing={1} alignItems="center" textAlign="center">
                            <Box
                                sx={{
                                    p: 1.5,
                                    bgcolor: 'primary.main',
                                    borderRadius: '50%',
                                    color: 'primary.contrastText',
                                    mb: 0.5,
                                }}
                            >
                                <GroupAddIcon fontSize="large" />
                            </Box>
                            <Typography variant="h5" fontWeight="bold">
                                招待が届いています
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                以下の事業所への参加招待です
                            </Typography>
                        </Stack>

                        <Divider />

                        {/* 招待詳細カード */}
                        <Paper
                            variant="outlined"
                            sx={{ p: 2, bgcolor: 'background.tint', borderRadius: 2 }}
                        >
                            <Stack spacing={1.5}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <BusinessIcon color="primary" fontSize="small" />
                                    <Box>
                                        <Typography variant="caption" color="text.secondary">事業所名</Typography>
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            {preview?.orgName}
                                        </Typography>
                                    </Box>
                                </Stack>

                                {preview?.roleNames && preview.roleNames.length > 0 && (
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                            割り当てロール
                                        </Typography>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                            {preview.roleNames.map((name) => (
                                                <Chip key={name} label={name} size="small" variant="outlined" color="primary" />
                                            ))}
                                        </Box>
                                    </Box>
                                )}

                                {preview?.expiresAt && (
                                    <Typography variant="caption" color="text.disabled">
                                        有効期限: {new Date(preview.expiresAt).toLocaleDateString('ja-JP')}
                                    </Typography>
                                )}
                            </Stack>
                        </Paper>

                        <Divider />

                        {/* CTA */}
                        <Stack spacing={1.5}>
                            <Typography variant="body2" color="text.secondary" textAlign="center">
                                参加するにはログインまたはアカウント登録が必要です
                            </Typography>
                            <AppButton
                                size="large"
                                fullWidth
                                startIcon={<LoginIcon />}
                                onClick={() => router.push(loginUrl)}
                            >
                                ログインして参加
                            </AppButton>
                            <AppButton
                                size="large"
                                fullWidth
                                variant="outlined"
                                intent="secondary"
                                startIcon={<PersonAddIcon />}
                                onClick={() => router.push(registerUrl)}
                            >
                                新規登録して参加
                            </AppButton>
                        </Stack>
                    </Stack>
                )}
            </Paper>
        </Box>
    );
}
