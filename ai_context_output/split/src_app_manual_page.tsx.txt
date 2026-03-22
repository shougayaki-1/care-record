'use client';

import { Box, Container, Typography, Grid, Card, CardActionArea, Chip } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import { useRouter } from 'next/navigation';

// マニュアルデータの定義
const manuals = [
    {
        id: 'form-settings',
        title: '記録フォームの設定',
        description: '利用者ごとの記録項目（フォーム）をカスタマイズする方法や、テンプレートの読み込み手順について、実際の画面を見ながら解説します。',
        icon: <DescriptionIcon fontSize="large" sx={{ color: 'primary.main' }} />,
        link: '/manual/form-settings',
        category: '管理者向け'
    },
    // 将来的にマニュアルが増えたらここに追加します
];

export default function ManualPortalPage() {
    const router = useRouter();

    return (
        <Box sx={{ py: 8, bgcolor: '#f5f5f5', minHeight: '100%' }}>
            <Container maxWidth="lg">
                <Box textAlign="center" mb={8}>
                    <Typography variant="h3" fontWeight="bold" color="text.primary" gutterBottom>
                        マニュアルセンター
                    </Typography>
                    <Typography variant="h6" color="text.secondary">
                        CareRecordの操作方法や設定手順をご案内します。
                    </Typography>
                </Box>

                <Box mb={6}>
                    <Typography variant="h5" fontWeight="bold" color="primary.main" sx={{ mb: 3, borderLeft: '6px solid #2255CC', pl: 2 }}>
                        管理者向け機能
                    </Typography>
                    
                    <Grid container spacing={3}>
                        {manuals.filter(m => m.category === '管理者向け').map((manual) => (
                            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={manual.id}>
                                <Card 
                                    variant="outlined" 
                                    sx={{ 
                                        height: '100%', 
                                        borderRadius: 3, 
                                        border: '1px solid #e0e0e0',
                                        transition: 'all 0.2s',
                                        '&:hover': { 
                                            transform: 'translateY(-4px)',
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                                            borderColor: 'primary.light'
                                        }
                                    }}
                                >
                                    <CardActionArea 
                                        onClick={() => router.push(manual.link)} 
                                        sx={{ height: '100%', p: 3, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start' }}
                                    >
                                        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#eef2ff', mb: 2 }}>
                                            {manual.icon}
                                        </Box>
                                        <Typography variant="h6" fontWeight="bold" gutterBottom>
                                            {manual.title}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flexGrow: 1, lineHeight: 1.6 }}>
                                            {manual.description}
                                        </Typography>
                                        <Chip label={manual.category} size="small" color="primary" variant="outlined" />
                                    </CardActionArea>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                </Box>

                {/* ヘルパー向けカテゴリの例（コンテンツが増えたらコメントアウトを解除） */}
                {/* 
                <Box mb={6}>
                    <Typography variant="h5" fontWeight="bold" color="secondary.main" sx={{ mb: 3, borderLeft: '6px solid #f50057', pl: 2 }}>
                        ヘルパー向け機能
                    </Typography>
                    <Typography color="text.secondary">現在準備中です。</Typography>
                </Box> 
                */}

            </Container>
        </Box>
    );
}