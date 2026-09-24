'use client';

import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import PersonIcon from '@mui/icons-material/Person';

import { DateTimeField, MultiSelectField } from '@/components/ui';
import { Box, MenuItem, Stack, TextField, Typography } from '@/components/ui/mui';
import type { ActualStaffInput, HelperProfile, ServiceTypeOption, StaffRoleOption, TravelExpense } from '@/hooks/useRecordForm';

type RecordMetaFormProps = {
  actualServiceTypeId: string;
  serviceTypes: ServiceTypeOption[];
  selectedHelpers: string[];
  selectableStaffs: HelperProfile[];
  actualStaffs: ActualStaffInput[];
  staffRoles: StaffRoleOption[];
  startDateTime: string;
  endDateTime: string;
  serviceTime: string;
  travelTime: string;
  travelExpenses: Record<string, TravelExpense>;
  applyDefaultTravelCosts: boolean;
  errors: Record<string, string>;
  aiFilledFields: Set<string>;
  disabled: boolean;
  onServiceTypeChange: (value: string) => void;
  onStaffChange: (value: string[]) => void;
  onActualStaffsChange: (value: ActualStaffInput[] | ((previous: ActualStaffInput[]) => ActualStaffInput[])) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onServiceTimeChange: (value: string) => void;
  onTravelTimeChange: (value: string) => void;
  onTravelExpenseChange: (staffId: string, expense: TravelExpense) => void;
};

export function RecordMetaForm(props: RecordMetaFormProps) {
  const {
    actualServiceTypeId, serviceTypes, selectedHelpers, selectableStaffs, actualStaffs,
    staffRoles, startDateTime, endDateTime, serviceTime, travelTime,
    travelExpenses, applyDefaultTravelCosts, errors,
    aiFilledFields, disabled, onServiceTypeChange, onStaffChange, onActualStaffsChange,
    onStartChange, onEndChange, onServiceTimeChange, onTravelTimeChange, onTravelExpenseChange,
  } = props;

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1, bgcolor: 'background.paper' }}>
      <Stack spacing={3}>
        <Box sx={{ p: 1, mx: -1, borderRadius: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom>実績サービス種別</Typography>
          <TextField select fullWidth label="実績サービス種別" value={actualServiceTypeId} onChange={(event) => onServiceTypeChange(event.target.value)} disabled={disabled} helperText="予定と異なる場合は実際に提供したサービス種別を選択してください">
            <MenuItem value="">未設定</MenuItem>
            {serviceTypes.map((serviceType) => <MenuItem key={serviceType.id} value={serviceType.id}>{serviceType.name}</MenuItem>)}
          </TextField>
        </Box>

        <Box sx={{ bgcolor: aiFilledFields.has('_helpers') ? 'background.aiHighlight' : 'transparent', p: 1, mx: -1, borderRadius: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
            <PersonIcon fontSize="small" /> 担当スタッフ <Typography component="span" color="error">*</Typography>
          </Typography>
          <MultiSelectField required label="担当スタッフ" options={Array.from(new Set(selectableStaffs.map((helper) => helper.name)))} value={selectedHelpers} onChange={onStaffChange} getOptionLabel={(name) => name} getOptionValue={(name) => name} error={!!errors.helpers} helperText={errors.helpers} placeholder="スタッフ名簿から選択" disabled={disabled} />
          {actualStaffs.length > 0 && (
            <Stack spacing={1.5} mt={2}>
              {actualStaffs.map((actualStaff) => {
                const staff = selectableStaffs.find((helper) => helper.id === actualStaff.staff_id);
                return (
                  <Stack key={actualStaff.staff_id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <Typography variant="body2" sx={{ minWidth: 140, fontWeight: 'bold' }}>{staff?.name ?? '担当スタッフ'}</Typography>
                    <TextField select size="small" fullWidth label="実績役割" value={actualStaff.staff_role_id ?? ''} onChange={(event) => onActualStaffsChange((previous) => previous.map((item) => item.staff_id === actualStaff.staff_id ? { ...item, staff_role_id: event.target.value || null } : item))} disabled={disabled}>
                      <MenuItem value="">未設定</MenuItem>
                      {staffRoles.map((role) => <MenuItem key={role.id} value={role.id}>{role.name}</MenuItem>)}
                    </TextField>
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Box>

        <Box sx={{ bgcolor: aiFilledFields.has('startDateTime') || aiFilledFields.has('endDateTime') ? 'background.aiHighlight' : 'transparent', p: 1, mx: -1, borderRadius: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}><CalendarTodayIcon fontSize="small" /> サービス日時</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <DateTimeField value={startDateTime} onChange={(event) => onStartChange(event.target.value)} disabled={disabled} />
            <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>～</Typography>
            <DateTimeField value={endDateTime} onChange={(event) => onEndChange(event.target.value)} disabled={disabled} />
          </Stack>
        </Box>

        <Box sx={{ bgcolor: aiFilledFields.has('serviceTime') ? 'background.aiHighlight' : 'transparent', p: 1, mx: -1, borderRadius: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}><AccessTimeIcon fontSize="small" /> 提供時間 <Typography component="span" color="error">*</Typography></Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="サービス提供" type="number" fullWidth value={serviceTime} onChange={(event) => onServiceTimeChange(event.target.value)} onWheel={(event) => (event.target as HTMLElement).blur()} error={!!errors.serviceTime} disabled={disabled} slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.5' } }} />
            <TextField label="移動" type="number" fullWidth value={travelTime} onChange={(event) => onTravelTimeChange(event.target.value)} onWheel={(event) => (event.target as HTMLElement).blur()} disabled={disabled} slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.5' } }} />
          </Stack>
        </Box>

        <Box>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom>スタッフ別の交通費（精算額）</Typography>
          <Typography variant="caption" color="text.secondary" display="block" mb={1}>1訪問あたりの往復額です。いつもと違う日は金額を変更してください。</Typography>
          <Stack spacing={1.5}>
            {actualStaffs.map((actualStaff) => {
              const staff = selectableStaffs.find((helper) => helper.id === actualStaff.staff_id);
              const expense = travelExpenses[actualStaff.staff_id] ?? { method: 'car', amountYen: applyDefaultTravelCosts && staff?.defaultTravelCostYen != null ? String(staff.defaultTravelCostYen) : '' };
              return <Stack key={actualStaff.staff_id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Typography variant="body2" sx={{ minWidth: 120, fontWeight: 'bold' }}>{staff?.name ?? '担当スタッフ'}</Typography>
                <TextField select size="small" label="移動手段" value={expense.method} onChange={(event) => { const method = event.target.value as TravelExpense['method']; onTravelExpenseChange(actualStaff.staff_id, { method, amountYen: method === 'none' ? '0' : method === 'car' ? (staff?.defaultTravelCostYen == null ? '' : String(staff.defaultTravelCostYen)) : '' }); }} disabled={disabled} sx={{ minWidth: 150 }}>
                  <MenuItem value="car">車</MenuItem><MenuItem value="public_transport">公共交通機関</MenuItem><MenuItem value="other">その他</MenuItem><MenuItem value="none">交通費なし</MenuItem>
                </TextField>
                <TextField size="small" type="number" label="精算額" value={expense.amountYen} onChange={(event) => onTravelExpenseChange(actualStaff.staff_id, { ...expense, amountYen: event.target.value })} disabled={disabled || expense.method === 'none'} error={Boolean(errors[`travel_${actualStaff.staff_id}`])} helperText={errors[`travel_${actualStaff.staff_id}`]} slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">円</Typography> }, htmlInput: { inputMode: 'numeric', step: 1, min: 0, max: 100000 } }} />
              </Stack>;
            })}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
