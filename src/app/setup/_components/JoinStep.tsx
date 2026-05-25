'use client';

import { Box, Typography, TextField, Button, Stack } from '@mui/material';
import GroupAddIcon from '@mui/icons-material/GroupAdd';

type Props = {
    inviteCode: string;
    setInviteCode: (val: string) => void;
    onJoin: () => void;
    onBack: () => void;
    submitting: boolean;
};

export function JoinStep({ inviteCode, setInviteCode, onJoin, onBack, submitting }: Props) {
    return (
        <Stack spacing={3}>
            <Box textAlign="center">
                <GroupAddIcon color="secondary" sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="h5" fontWeight="bold">事業所に参加</Typography>
                <Typography variant="body2" color="text.secondary">
                    管理者から共有された招待コードを入力してください。
                </Typography>
            </Box>
            <TextField 
                label="招待コード" 
                placeholder="コードを入力" 
                fullWidth 
                value={inviteCode} 
                onChange={(e) => setInviteCode(e.target.value)} 
            />
            <Stack direction="row" spacing={2}>
                <Button fullWidth onClick={onBack} disabled={submitting}>
                    戻る
                </Button>
                <Button 
                    variant="contained" fullWidth size="large" 
                    onClick={onJoin} disabled={submitting || !inviteCode.trim()}
                >
                    {submitting ? '参加中...' : '参加する'}
                </Button>
            </Stack>
        </Stack>
    );
}