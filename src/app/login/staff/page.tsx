'use client';
import { Box, Container, Paper, Button } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useRouter } from 'next/navigation';
import { AuthForm } from '@/components/auth/AuthForm';

export default function StaffLoginPage() {
    const router = useRouter();
    return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f0f2f5' }}>
            <Container maxWidth="xs">
                <Button startIcon={<ArrowBackIcon />} onClick={() => router.push('/')} sx={{ mb: 2 }}>TOPへ戻る</Button>
                <Paper elevation={0} sx={{ p: 5, borderRadius: 4, border: '1px solid #e0e0e0', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                    <AuthForm mode="staff" />
                </Paper>
            </Container>
        </Box>
    );
}