'use client';

import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import PersonIcon from '@mui/icons-material/Person';

import { DateTimeField, MultiSelectField } from '@/components/ui';
import { Box, Chip, MenuItem, Stack, TextField, Typography } from '@/components/ui/mui';
import type { ActualStaffInput, HelperProfile, ServiceTypeOption, StaffRoleOption } from '@/hooks/useRecordForm';

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
  roundTripDistanceKm: string;
  travelCostYen: number;
  travelCostRateYenPerKm: number;
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
  onDistanceChange: (value: string) => void;
};

export function RecordMetaForm(props: RecordMetaFormProps) {
  const {
    actualServiceTypeId, serviceTypes, selectedHelpers, selectableStaffs, actualStaffs,
    staffRoles, startDateTime, endDateTime, serviceTime, travelTime,
    roundTripDistanceKm, travelCostYen, travelCostRateYenPerKm, errors,
    aiFilledFields, disabled, onServiceTypeChange, onStaffChange, onActualStaffsChange,
    onStartChange, onEndChange, onServiceTimeChange, onTravelTimeChange, onDistanceChange,
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
            <TextField label="移動" type="number" fullWidth value={travelTime} onChange={(event) => onTravelTimeChange(event.target.value)} onWheel={(event) => (event.target as HTMLElement).blur()} disabled={disabled} slotProps={{ input: { startAdornment: <DirectionsCarIcon color="action" fontSize="small" sx={{ mr: 1 }} />, endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.5' } }} />
          </Stack>
        </Box>

        <Box>
          <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}><DirectionsCarIcon fontSize="small" /> 移動距離・交通費</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <TextField label="往復距離" type="number" fullWidth value={roundTripDistanceKm} onChange={(event) => onDistanceChange(event.target.value)} disabled={disabled} onWheel={(event) => (event.target as HTMLElement).blur()} slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">km</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.1' } }} />
            <Chip label={`交通費 ${travelCostYen.toLocaleString()}円（${travelCostRateYenPerKm.toLocaleString()}円/km）`} color="primary" variant="outlined" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, fontWeight: 'bold' }} />
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
