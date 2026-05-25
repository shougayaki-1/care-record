'use client';

import React from 'react';
import {
    Box, Typography, TextField, Checkbox, FormControl, InputLabel, Select, MenuItem, OutlinedInput, Chip, Stack, FormControlLabel, FormHelperText
} from '@mui/material';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import PersonIcon from '@mui/icons-material/Person';
import { SelectChangeEvent } from '@mui/material/Select';
import { MenuProps } from '@/constants/ui';

type HelperProfile = { id: string; name: string };

type Props = {
    selectableStaffs: HelperProfile[];
    selectedHelpers: string[];
    setSelectedHelpers: (helpers: string[]) => void;
    startDateTime: string;
    setStartDateTime: (val: string) => void;
    endDateTime: string;
    setEndDateTime: (val: string) => void;
    serviceTime: string;
    setServiceTime: (val: string) => void;
    travelTime: string;
    setTravelTime: (val: string) => void;
    errors: Record<string, string>;
    handleChange: (setter: (val: string) => void, val: string) => void;
};

export function RecordHeader({
    selectableStaffs, selectedHelpers, setSelectedHelpers,
    startDateTime, setStartDateTime, endDateTime, setEndDateTime,
    serviceTime, setServiceTime, travelTime, setTravelTime,
    errors, handleChange
}: Props) {

    const handleStaffChange = (event: SelectChangeEvent<typeof selectedHelpers>) => {
        const { target: { value } } = event;
        setSelectedHelpers(typeof value === 'string' ? value.split(',') : value);
    };

    return (
        <Stack spacing={3}>
            <Box>
                <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                    <PersonIcon fontSize="small" /> 担当スタッフ <Typography component="span" color="error">*</Typography>
                </Typography>
                <FormControl fullWidth error={!!errors.helpers}>
                    <Select
                        multiple
                        displayEmpty
                        value={selectedHelpers}
                        onChange={handleStaffChange}
                        input={<OutlinedInput />}
                        renderValue={(selected) => {
                            if (selected.length === 0) {
                                return <Typography color="text.disabled">スタッフ名簿から選択</Typography>;
                            }
                            return (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {selected.map((value) => (
                                        <Chip key={value} label={value} size="small" variant="outlined" />
                                    ))}
                                </Box>
                            );
                        }}
                        MenuProps={MenuProps}
                    >
                        {Array.from(new Set(selectableStaffs.map(h => h.name))).map((name) => (
                            <MenuItem key={name} value={name}>
                                <Checkbox checked={selectedHelpers.indexOf(name) > -1} size="small" />
                                <Typography variant="body2" sx={{ fontWeight: selectedHelpers.includes(name) ? 'bold' : 'normal' }}>{name}</Typography>
                            </MenuItem>
                        ))}
                    </Select>
                    {errors.helpers && <FormHelperText>{errors.helpers}</FormHelperText>}
                </FormControl>
            </Box>

            <Box>
                <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                    <CalendarTodayIcon fontSize="small" /> サービス日時
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                    <TextField type="datetime-local" fullWidth value={startDateTime} onChange={e => handleChange(setStartDateTime, e.target.value)} InputLabelProps={{ shrink: true }} />
                    <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>～</Typography>
                    <TextField type="datetime-local" fullWidth value={endDateTime} onChange={e => handleChange(setEndDateTime, e.target.value)} InputLabelProps={{ shrink: true }} />
                </Stack>
            </Box>

            <Box>
                <Typography variant="subtitle2" color="text.secondary" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={0.5}>
                    <AccessTimeIcon fontSize="small" /> 提供時間 <Typography component="span" color="error">*</Typography>
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField label="サービス提供" type="number" fullWidth value={serviceTime} onChange={e => handleChange(setServiceTime, e.target.value)} error={!!errors.serviceTime} InputProps={{ endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }} inputProps={{ inputMode: 'decimal', step: '0.5' }} />
                    <TextField label="移動" type="number" fullWidth value={travelTime} onChange={e => handleChange(setTravelTime, e.target.value)} InputProps={{ startAdornment: <DirectionsCarIcon color="action" fontSize="small" sx={{ mr: 1 }} />, endAdornment: <Typography variant="caption" color="text.secondary">時間</Typography> }} inputProps={{ inputMode: 'decimal', step: '0.5' }} />
                </Stack>
            </Box>
        </Stack>
    );
}