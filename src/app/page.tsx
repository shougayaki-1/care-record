// app/page.tsx
'use client';

import { Box, Container, Typography, Paper, Stack, Card, CardActionArea, CardContent, SvgIcon } from '@mui/material';
import { useRouter } from 'next/navigation';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import Diversity1Icon from '@mui/icons-material/Diversity1';

export default function LandingPage() {
  const router = useRouter();

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: '#f8f9fa', p: 3 }}>

      {/* タイトルエリア */}
      <Box textAlign="center" mb={6}>
        <Typography
          variant="h3"
          component="h1"
          sx={{
            fontFamily: 'var(--font-poppins)',
            fontWeight: 800,
            color: '#2255CC',
            letterSpacing: '-1px',
            mb: 1
          }}
        >
          CareRecord
        </Typography>
        <Typography variant="h6" color="text.secondary" fontWeight="normal">
          訪問介護記録を、もっとシンプルに。
        </Typography>
      </Box>

      {/* 選択カードエリア */}
      <Container maxWidth="md">
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} justifyContent="center">

          {/* 管理者向けカード */}
          <Card
            elevation={0}
            sx={{
              flex: 1,
              borderRadius: 4,
              border: '1px solid #e0e0e0',
              transition: 'transform 0.2s, box-shadow 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: '0 12px 24px rgba(34, 85, 204, 0.1)',
                borderColor: '#2255CC'
              }
            }}
          >
            <CardActionArea
              onClick={() => router.push('/login/admin')}
              sx={{ height: '100%', p: 4, textAlign: 'center' }}
            >
              <Box
                sx={{
                  width: 80, height: 80, borderRadius: '50%', bgcolor: '#eef2ff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 3
                }}
              >
                <BusinessCenterIcon sx={{ fontSize: 40, color: '#2255CC' }} />
              </Box>
              <Typography variant="h5" fontWeight="bold" gutterBottom>
                管理者・責任者
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                事業所の登録、スタッフ管理、<br />
                実績の確認・承認はこちら
              </Typography>
              <Box mt={3}>
                <Typography variant="button" sx={{ color: '#2255CC', fontWeight: 'bold' }}>
                  ログイン / 新規登録 &rarr;
                </Typography>
              </Box>
            </CardActionArea>
          </Card>

          {/* スタッフ向けカード */}
          <Card
            elevation={0}
            sx={{
              flex: 1,
              borderRadius: 4,
              border: '1px solid #e0e0e0',
              transition: 'transform 0.2s, box-shadow 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: '0 12px 24px rgba(34, 85, 204, 0.1)',
                borderColor: '#2255CC'
              }
            }}
          >
            <CardActionArea
              onClick={() => router.push('/login/staff')}
              sx={{ height: '100%', p: 4, textAlign: 'center' }}
            >
              <Box
                sx={{
                  width: 80, height: 80, borderRadius: '50%', bgcolor: '#e0f2f1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 3
                }}
              >
                <Diversity1Icon sx={{ fontSize: 40, color: '#00695c' }} />
              </Box>
              <Typography variant="h5" fontWeight="bold" gutterBottom>
                ヘルパー・スタッフ
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                日々のサービス提供記録の入力、<br />
                過去の履歴確認はこちら
              </Typography>
              <Box mt={3}>
                <Typography variant="button" sx={{ color: '#00695c', fontWeight: 'bold' }}>
                  ログイン &rarr;
                </Typography>
              </Box>
            </CardActionArea>
          </Card>

        </Stack>

        <Box mt={6} textAlign="center">
          <Typography variant="caption" color="text.secondary">
            &copy; 2025 CareRecord SaaS. All rights reserved.
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}