import type { ReactNode } from 'react';
import { Box, Stack } from '@/components/ui/mui';
import { SelectField } from '@/components/ui';
import type { ClientData, StaffData } from '@/features/shifts/types';
import type { ShiftManageTab } from '@/features/shifts/manageTypes';

type Props = {
    activeTab: ShiftManageTab; selectedStaffId: string; selectedClientId: string;
    staffs: StaffData[]; clients: ClientData[];
    onStaffChange: (id: string) => void; onClientChange: (id: string) => void;
    children?: ReactNode;
};
export function ShiftManageFilters({ activeTab, selectedStaffId, selectedClientId, staffs, clients, onStaffChange, onClientChange, children }: Props) {
    return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={2} spacing={2}>
        <Box flexGrow={1} width="100%">
            {activeTab === 'byStaff' && (
                <SelectField size="small" label="スタッフを選択" value={selectedStaffId} onChange={onStaffChange} options={[{ value: "all", label: "全員を表示" }, ...staffs.map(s => ({ value: s.id, label: s.name }))]} sx={{ minWidth: { xs: 0, sm: 200 }, width: { xs: '100%', sm: 'auto' }, bgcolor: 'background.paper' }} />
            )}
            {activeTab === 'byClient' && (
                <SelectField size="small" label="利用者を選択" value={selectedClientId} onChange={onClientChange} options={[{ value: "all", label: "全員を表示" }, ...clients.map(c => ({ value: c.id, label: c.name }))]} sx={{ minWidth: { xs: 0, sm: 200 }, width: { xs: '100%', sm: 'auto' }, bgcolor: 'background.paper' }} />
            )}
        </Box>
        {children}
    </Stack>
    );
}
