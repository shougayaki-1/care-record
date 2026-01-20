'use client';

import { useEffect, useState } from 'react';
import { Box, Typography, Paper, TextField, Button, Alert, CircularProgress, Stack, Divider } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import SaveIcon from '@mui/icons-material/Save';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
    const { currentOrg, loading: wsLoading, refreshWorkspace } = useWorkspace();
    const router = useRouter();
    const [orgName, setOrgName] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            if (currentOrg.role !== 'owner') {
                router.push('/app'); // 権限がない場合はリダイレクト
                return;
            }
            setOrgName(currentOrg.name);
        }
    }, [wsLoading, currentOrg, router]);

    const handleSave = async () => {
        if (!orgName.trim() || !currentOrg) return;
        setSaving(true);
        try {
            const { error } = await supabase
                .from('organizations')
                .update({ name: orgName })
                .eq('id', currentOrg.id);

            if (error) throw error;
            setMessage({ type: 'success', text: '更新しました' });
            refreshWorkspace(); // サイドバーなどの表示名も更新
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: '更新失敗' });
        } finally {
            setSaving(false);
        }
    };

    if (wsLoading || !currentOrg) return <CircularProgress />;

    return (
        <Box sx={{ maxWidth: 800, mx: 'auto' }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                <BusinessIcon color="primary" /> 事業所設定
            </Typography>
            {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

            <Paper variant="outlined" sx={{ p: 4, borderRadius: 3 }}>
                <Stack spacing={4}>
                    <Box>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>事業所名</Typography>
                        <TextField fullWidth value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                    </Box>
                    <Divider />
                    <Box textAlign="right">
                        <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
                            {saving ? '保存中...' : '変更を保存'}
                        </Button>
                    </Box>
                </Stack>
            </Paper>
        </Box>
    );
}