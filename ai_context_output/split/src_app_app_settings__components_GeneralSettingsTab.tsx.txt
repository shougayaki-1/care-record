'use client';

import { Box, TextField, Button, Divider, Stack, Typography } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

interface Props {
    orgName: string;
    setOrgName: (val: string) => void;
    isOwner: boolean;
    saving: boolean;
    onSave: () => Promise<void>;
}

export function GeneralSettingsTab({ orgName, setOrgName, isOwner, saving, onSave }: Props) {
    return (
        <Stack spacing={3}>
            <Box>
                <Typography variant="h6" fontWeight="bold" gutterBottom>事業所名</Typography>
                <TextField 
                    fullWidth 
                    value={orgName} 
                    onChange={(e) => setOrgName(e.target.value)} 
                    disabled={!isOwner} 
                    placeholder="事業所名を入力"
                />
            </Box>
            <Divider />
            {isOwner && (
                <Box textAlign="right">
                    <Button 
                        variant="contained" 
                        size="large" 
                        startIcon={<SaveIcon />} 
                        onClick={onSave} 
                        disabled={saving || !orgName.trim()}
                    >
                        {saving ? '保存中...' : '変更を保存'}
                    </Button>
                </Box>
            )}
        </Stack>
    );
}