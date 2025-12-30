// app/helper/layout.tsx
'use client';

import { Box, AppBar, Toolbar, Typography, IconButton, Container } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import PersonIcon from '@mui/icons-material/Person';
import HomeIcon from '@mui/icons-material/Home';
import { useRouter, usePathname } from 'next/navigation';

export default function HelperLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: '#f4f7f9' }}>
            <AppBar position="sticky" elevation={0} sx={{ bgcolor: '#fff', color: '#333', borderBottom: '1px solid #e0e0e0' }}>
                <Container maxWidth="md">
                    <Toolbar disableGutters sx={{ justifyContent: 'space-between' }}>
                        <Typography
                            variant="h6"
                            onClick={() => router.push('/helper')}
                            sx={{ fontWeight: 900, color: '#2255CC', cursor: 'pointer', fontFamily: 'var(--font-poppins)' }}
                        >
                            CareRecord
                        </Typography>
                        <Box>
                            <IconButton color={pathname === '/helper' ? 'primary' : 'inherit'} onClick={() => router.push('/helper')}><HomeIcon /></IconButton>
                            <IconButton color={pathname === '/helper/history' ? 'primary' : 'inherit'} onClick={() => router.push('/helper/history')}><HistoryIcon /></IconButton>
                            <IconButton color={pathname === '/profile' ? 'primary' : 'inherit'} onClick={() => router.push('/profile')}><PersonIcon /></IconButton>
                        </Box>
                    </Toolbar>
                </Container>
            </AppBar>

            <Box component="main" sx={{ py: { xs: 2, md: 4 } }}>
                <Container maxWidth="md">
                    {children}
                </Container>
            </Box>
        </Box>
    );
}