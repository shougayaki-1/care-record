'use client';

import { Box, Typography, TextField, Stack, Avatar, IconButton, CircularProgress } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import PhotoCamera from '@mui/icons-material/PhotoCamera';
import { Workspace } from '@/context/WorkspaceContext';

interface Props {
    name: string;
    setName: (val: string) => void;
    avatarUrl: string | null;
    uploading: boolean;
    currentOrg: Workspace | null;
    onAvatarUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function ProfileForm({
    name, setName, avatarUrl, uploading, currentOrg, onAvatarUpload
}: Props) {
    return (
        <Stack spacing={4} alignItems="center" textAlign="center">
            {/* アバター画像アップロード */}
            <Box position="relative" display="inline-block" mb={1}>
                <Avatar 
                    src={avatarUrl || undefined} 
                    sx={{ width: 100, height: 100, mx: 'auto', fontSize: 40, bgcolor: 'primary.main' }}
                >
                    {name[0] || '?'}
                </Avatar>
                <IconButton 
                    color="primary" 
                    component="label" 
                    sx={{ 
                        position: 'absolute', 
                        bottom: 0, 
                        right: -10, 
                        bgcolor: 'white', 
                        boxShadow: 2, 
                        '&:hover': { bgcolor: '#f0f0f0' } 
                    }}
                >
                    <input hidden accept="image/*" type="file" onChange={onAvatarUpload} />
                    {uploading ? <CircularProgress size={24} /> : <PhotoCamera />}
                </IconButton>
            </Box>

            {/* 基本情報入力 */}
            <Box sx={{ width: '100%', textAlign: 'left' }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                    <PersonIcon color="primary" /> 基本情報
                </Typography>
                <Stack spacing={2} mt={1}>
                    <TextField 
                        label="氏名" 
                        value={name} 
                        onChange={(e) => setName(e.target.value)} 
                        fullWidth 
                        required 
                    />
                    {currentOrg && (
                        <TextField 
                            label="現在の事業所での権限" 
                            value={currentOrg.role} 
                            disabled 
                            fullWidth 
                            size="small" 
                            helperText={`事業所: ${currentOrg.name}`} 
                        />
                    )}
                </Stack>
            </Box>
        </Stack>
    );
}