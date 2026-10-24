'use client';

import { Box, Divider, Stack, Typography } from '@/components/ui/mui';
import { AppButton } from '@/components/ui';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import WarningIcon from '@mui/icons-material/Warning';

type OrganizationDangerSettingsProps = {
  canDeleteOrganization: boolean;
  onLeave: () => void;
  onDelete: () => void;
};

export function OrganizationDangerSettings({ canDeleteOrganization, onLeave, onDelete }: OrganizationDangerSettingsProps) {
  return (
    <Stack spacing={3}>
        {/* 危険な設定 */}
        <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1, borderColor: 'error.light', bgcolor: 'background.danger' }}>
            <Stack direction="row" alignItems="center" gap={1} mb={2}>
                <WarningIcon color="error" />
                <Typography variant="h6" fontWeight="bold" color="error">危険な設定</Typography>
            </Stack>
            <Stack spacing={2}>
                <Box display="flex" justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} flexDirection={{ xs: 'column', sm: 'row' }} gap={1.5}>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight="bold">事業所から脱退</Typography>
                        <Typography variant="caption" color="text.secondary">この事業所のメンバーから外れます</Typography>
                    </Box>
                    <AppButton variant="outlined" intent="warning" startIcon={<ExitToAppIcon />} onClick={onLeave}>
                        脱退する
                    </AppButton>
                </Box>
                {canDeleteOrganization && (
                    <>
                        <Divider />
                        <Box display="flex" justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} flexDirection={{ xs: 'column', sm: 'row' }} gap={1.5}>
                            <Box sx={{ minWidth: 0 }}>
                                <Typography fontWeight="bold" color="error">事業所を削除</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    事業所を利用不能な削除保留状態にします。記録は保持方針に従い保全されます。
                                </Typography>
                            </Box>
                            <AppButton intent="danger" onClick={onDelete}>
                                削除する
                            </AppButton>
                        </Box>
                    </>
                )}
            </Stack>
        </Box>
    </Stack>
  );
}
