// src/components/auth/TermsAgreementModal.tsx
'use client';

import { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Typography, Box, FormControlLabel, Checkbox
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import LaunchIcon from '@mui/icons-material/Launch';

export const TermsAgreementModal = () => {
    const [open, setOpen] = useState(false);
    const [checked, setChecked] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        checkAgreement();
    }, []);

    const checkAgreement = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);

        const { data } = await supabase
            .from('profiles')
            .select('is_agreed')
            .eq('id', user.id)
            .single();

        // 同意していなければモーダルを開く
        if (data && !data.is_agreed) {
            setOpen(true);
        }
    };

    const handleAgree = async () => {
        if (!userId) return;
        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    is_agreed: true,
                    agreed_at: new Date().toISOString()
                })
                .eq('id', userId);

            if (error) throw error;
            setOpen(false);
        } catch (error) {
            console.error(error);
            alert('エラーが発生しました');
        }
    };

    // LPのURL（ここにアップロード先のURLを入れてください）
    // まだなければ仮置きでOK
    const TERMS_URL = "http://localhost:5500/index.html"; // ← ローカルテスト用や公開URL

    return (
        <Dialog
            open={open}
            disableEscapeKeyDown
            fullWidth
            maxWidth="sm"
            PaperProps={{ sx: { borderRadius: 3 } }}
        >
            <DialogTitle sx={{ fontWeight: 'bold', textAlign: 'center', pt: 4 }}>
                利用規約への同意
            </DialogTitle>

            <DialogContent>
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

                    <Box mt={3} p={2} bgcolor="#f5f5f5" borderRadius={2} textAlign="left">
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
            </DialogContent>

            <DialogActions sx={{ p: 3, justifyContent: 'center' }}>
                <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    disabled={!checked}
                    onClick={handleAgree}
                    sx={{ borderRadius: 4, py: 1.5, fontWeight: 'bold' }}
                >
                    同意してサービスを利用する
                </Button>
            </DialogActions>
        </Dialog>
    );
};