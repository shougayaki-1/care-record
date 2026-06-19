// src/components/auth/TermsAgreementModal.tsx
'use client';

import { useState, useEffect } from 'react';
import {
    Button, Typography, Box, FormControlLabel, Checkbox
} from '@/components/ui/mui';
import { supabase } from '@/lib/supabase';
import LaunchIcon from '@mui/icons-material/Launch';
import { useToast } from '@/components/ui/ToastProvider';
import { AppButton, AppDialog } from '@/components/ui';
import { acceptCurrentTerms } from '@/app/actions/user';

export const TermsAgreementModal = () => {
    const { showToast } = useToast();
    const [open, setOpen] = useState(false);
    const [checked, setChecked] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        const checkAgreement = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setUserId(user.id);

            const { data } = await supabase
                .from('profiles')
                .select('is_agreed')
                .eq('id', user.id)
                .single();

            if (data && !data.is_agreed) setOpen(true);
        };
        void checkAgreement();
    }, []);

    const handleAgree = async () => {
        if (!userId) return;
        try {
            await acceptCurrentTerms();
            setOpen(false);
        } catch (error) {
            console.error(error);
            showToast('エラーが発生しました', 'error');
        }
    };

    // LPのURL（ここにアップロード先のURLを入れてください）
    // まだなければ仮置きでOK
    const TERMS_URL = "/terms.html";

    return (
        <AppDialog
            open={open}
            disableEscapeKeyDown
            maxWidth="sm"
            title="利用規約への同意"
            dividers={false}
            actions={<AppButton size="large" fullWidth disabled={!checked} onClick={handleAgree}>同意してサービスを利用する</AppButton>}
        >
                <Box textAlign="center" py={2}>
                    <Typography variant="body1" paragraph>
                        サービスを利用開始する前に、<br />
                        利用規約とプライバシーポリシーへの同意が必要です。
                    </Typography>

                    <Button
                        variant="outlined"
                        endIcon={<LaunchIcon />}
                        href={TERMS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ my: 2, borderRadius: 4 }}
                    >
                        規約・ポリシー全文を確認する
                    </Button>

                    <Box mt={3} p={2} bgcolor="background.muted" borderRadius={2} textAlign="left">
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={checked}
                                    onChange={(e) => setChecked(e.target.checked)}
                                />
                            }
                            label={
                                <Typography variant="body2">
                                    上記リンク先の利用規約およびプライバシーポリシーの内容を確認し、これに同意します。
                                </Typography>
                            }
                        />
                    </Box>
                </Box>
        </AppDialog>
    );
};
