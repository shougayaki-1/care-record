'use client';

import { Box, Divider, Stack, Typography } from '@/components/ui/mui';
import { AppButton, AppTextField } from '@/components/ui';
import SaveIcon from '@mui/icons-material/Save';

type OrganizationBasicsProps = {
  orgName: string;
  setOrgName: (value: string) => void;
  canEditOrganization: boolean;
  saving: boolean;
  handleSave: () => void | Promise<void>;
};

export function OrganizationBasics({ orgName, setOrgName, canEditOrganization, saving, handleSave }: OrganizationBasicsProps) {
  return (
    <Stack spacing={3}>
        {/* 基本情報 */}
        <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>基本情報</Typography>
            <Stack spacing={4}>
                <Box>
                    <Typography component="label" htmlFor="organization-name" variant="subtitle2" fontWeight="bold" gutterBottom>事業所名</Typography>
                    <AppTextField id="organization-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!canEditOrganization} />
                </Box>
                <Divider />
                {canEditOrganization && (
                    <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
                        <AppButton size="large" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                            {saving ? '保存中...' : '変更を保存'}
                        </AppButton>
                    </Box>
                )}
            </Stack>
        </Box>

    </Stack>
  );
}
