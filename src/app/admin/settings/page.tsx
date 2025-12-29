'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Alert, CircularProgress, Stack, Divider
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import SaveIcon from '@mui/icons-material/Save';
import { supabase } from '@/lib/supabase';

export default function SettingsPage() {
    const [orgName, setOrgName] = useState('');
    const [orgId, setOrgId] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        fetchOrgData();
    }, []);

    const fetchOrgData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: profile } = await supabase
                .from('profiles')
                .select('organization_id, organizations(id, name)')
                .eq('id', user.id)
                .single();

            if (profile && profile.organizations) {
                // 型エラー回避: 配列か単一か不明確なため、anyでキャストして柔軟に処理
                const orgData = profile.organizations as any;
                const org = Array.isArray(orgData) ? orgData[0] : orgData;

                if (org) {
                    setOrgId(org.id);
                    setOrgName(org.name);
                }
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!orgName.trim()) {
            setMessage({ type: 'error', text: '事業所名を入力してください' });
            return;
        }
        setSaving(true);
        setMessage(null);

        try {
            const { error } = await supabase
                .from('organizations')
                .update({ name: orgName })
                .eq('id', orgId);

            if (error) throw error;
            setMessage({ type: 'success', text: '事業所情報を更新しました' });
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: '更新に失敗しました' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

    return (
        <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BusinessIcon color="primary" /> 事業所設定
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={4}>
                事業所の基本情報を編集します。
            </Typography>

            {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                <Stack spacing={4}>
                    <Box>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                            事業所名
                        </Typography>
                        <TextField
                            fullWidth
                            variant="outlined"
                            value={orgName}
                            onChange={(e) => setOrgName(e.target.value)}
                            helperText="帳票や招待画面に表示される名称です"
                        />
                    </Box>

                    <Divider />

                    <Box>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom color="text.secondary">
                            契約プラン (現在は変更できません)
                        </Typography>
                        <Paper sx={{ p: 2, bgcolor: '#f5f5f5', display: 'inline-block' }}>
                            <Typography variant="body2" fontWeight="bold">スタンダードプラン (β版)</Typography>
                        </Paper>
                    </Box>

                    <Box textAlign="right">
                        <Button
                            variant="contained"
                            size="large"
                            startIcon={<SaveIcon />}
                            onClick={handleSave}
                            disabled={saving}
                            sx={{ minWidth: 200, fontWeight: 'bold' }}
                        >
                            {saving ? '保存中...' : '変更を保存'}
                        </Button>
                    </Box>
                </Stack>
            </Paper>
        </Box>
    );
}