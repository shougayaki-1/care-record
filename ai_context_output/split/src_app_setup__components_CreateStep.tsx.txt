'use client';

import { Box, Typography, TextField, Button, Stack } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';

type Props = {
    orgName: string;
    setOrgName: (val: string) => void;
    onCreate: () => void;
    onBack: () => void;
    submitting: boolean;
};

export function CreateStep({ orgName, setOrgName, onCreate, onBack, submitting }: Props) {
    return (
        <Stack spacing={3}>
            <Box textAlign="center">
                <BusinessIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="h5" fontWeight="bold">事業所の作成</Typography>
                <Typography variant="body2" color="text.secondary">
                    事業所の名称を入力してください。
                </Typography>
            </Box>
            <TextField 
                label="事業所名" 
                placeholder="例: ケアサービス東京" 
                fullWidth 
                value={orgName} 
                onChange={(e) => setOrgName(e.target.value)} 
            />
            <Stack direction="row" spacing={2}>
                <Button fullWidth onClick={onBack} disabled={submitting}>戻る</Button>
                <Button 
                    variant="contained" fullWidth size="large" 
                    onClick={onCreate} disabled={submitting || !orgName.trim()}
                >
                    {submitting ? '作成中...' : '作成して開始'}
                </Button>
            </Stack>
        </Stack>
    );
}