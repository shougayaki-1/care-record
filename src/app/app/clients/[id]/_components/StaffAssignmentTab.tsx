'use client';

import { Box, Card, CardContent, Checkbox, FormControlLabel, FormGroup, Typography } from '@mui/material';

type Staff = { id: string; name: string; type: 'member' | 'ghost' };

type Props = {
    allStaffs: Staff[];
    assignedStaffIds: string[];
    setAssignedStaffIds: React.Dispatch<React.SetStateAction<string[]>>;
};

export function StaffAssignmentTab({ allStaffs, assignedStaffIds, setAssignedStaffIds }: Props) {
    const handleToggleStaff = (staffId: string) => {
        setAssignedStaffIds(prev => prev.includes(staffId) ? prev.filter(id => id !== staffId) : [...prev, staffId]);
    };

    return (
        <Card variant="outlined">
            <CardContent>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>この利用者を担当するスタッフを選択してください</Typography>
                <Typography variant="body2" color="text.secondary" mb={3}>選択したスタッフのみが、記録入力画面の「担当ヘルパー」選択肢に表示されます。</Typography>
                <FormGroup>
                    <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, color: 'primary.main', fontWeight: 'bold' }}>メンバー（ログインユーザー）</Typography>
                    <Box display="flex" flexWrap="wrap" gap={2}>
                        {allStaffs.filter(s => s.type === 'member').map(staff => (
                            <FormControlLabel key={staff.id} control={<Checkbox checked={assignedStaffIds.includes(staff.id)} onChange={() => handleToggleStaff(staff.id)} />} label={staff.name} sx={{ minWidth: 150 }} />
                        ))}
                    </Box>
                    <Typography variant="subtitle2" sx={{ mt: 3, mb: 1, color: 'secondary.main', fontWeight: 'bold' }}>アカウントなし（転記用）</Typography>
                    <Box display="flex" flexWrap="wrap" gap={2}>
                        {allStaffs.filter(s => s.type === 'ghost').map(staff => (
                            <FormControlLabel key={staff.id} control={<Checkbox checked={assignedStaffIds.includes(staff.id)} onChange={() => handleToggleStaff(staff.id)} />} label={staff.name} sx={{ minWidth: 150 }} />
                        ))}
                    </Box>
                </FormGroup>
            </CardContent>
        </Card>
    );
}