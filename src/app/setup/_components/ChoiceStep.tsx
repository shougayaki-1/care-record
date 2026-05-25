'use client';

import { Box, Typography, Stack, Card, CardActionArea } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import Button from '@mui/material/Button';

type Step = 'profile' | 'choice' | 'create' | 'join';

type Props = {
    setStep: (step: Step) => void;
    hasMembership: boolean;
    onBackToApp: () => void;
};

export function ChoiceStep({ setStep, hasMembership, onBackToApp }: Props) {
    return (
        <Stack spacing={3}>
            <Box textAlign="center">
                <Typography variant="h5" fontWeight="bold">事業所の設定</Typography>
                <Typography variant="body2" color="text.secondary">
                    新しく事業所を立ち上げるか、<br/>既存の事業所に参加するか選んでください。
                </Typography>
            </Box>
            
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardActionArea onClick={() => setStep('create')} sx={{ p: 2 }}>
                    <Stack direction="row" alignItems="center" spacing={2}>
                        <Box sx={{ p: 1, bgcolor: '#e3f2fd', borderRadius: '50%', color: 'primary.main' }}>
                            <BusinessIcon />
                        </Box>
                        <Box>
                            <Typography fontWeight="bold">新しい事業所を作成する</Typography>
                            <Typography variant="caption" color="text.secondary">管理者として新しく登録します</Typography>
                        </Box>
                    </Stack>
                </CardActionArea>
            </Card>

            <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardActionArea onClick={() => setStep('join')} sx={{ p: 2 }}>
                    <Stack direction="row" alignItems="center" spacing={2}>
                        <Box sx={{ p: 1, bgcolor: '#f3e5f5', borderRadius: '50%', color: 'secondary.main' }}>
                            <GroupAddIcon />
                        </Box>
                        <Box>
                            <Typography fontWeight="bold">既存の事業所に参加する</Typography>
                            <Typography variant="caption" color="text.secondary">招待コードをお持ちの方はこちら</Typography>
                        </Box>
                    </Stack>
                </CardActionArea>
            </Card>

            {hasMembership && (
                <Button color="inherit" onClick={onBackToApp}>
                    キャンセルしてアプリに戻る
                </Button>
            )}
        </Stack>
    );
}