'use client';

import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Stack, FormControl, InputLabel,
    Select, MenuItem, Box, Typography, Checkbox, FormGroup,
    FormControlLabel, CircularProgress, Chip, OutlinedInput, SelectChangeEvent
} from '@mui/material';
import { ShiftPatternPayload } from '@/app/actions/shift';
import { ClientData, StaffData } from './ShiftFormModal';
import { useToast } from '@/components/ui/ToastProvider';

type Props = {
    open: boolean;
    onClose: () => void;
    onSave: (payload: ShiftPatternPayload, patternId?: string) => Promise<void>;
    clients: ClientData[];
    staffs: StaffData[];
    organizationId: string;
    initialData?: {
        id: string;
        client_id: string;
        title: string;
        start_time: string;
        end_time: string;
        rrule: string;
        shift_pattern_staffs: { staff_id: string }[];
    } | null;
};

const parseRrule = (rruleStr: string) => {
    let freq: 'WEEKLY' | 'MONTHLY' = 'WEEKLY';
    let interval = 1;
    let selectedDays: string[] = [];
    let selectedWeeks: string[] = [];

    if (!rruleStr) return { freq, interval, selectedDays, selectedWeeks };

    const parts = rruleStr.split(';');
    for (const part of parts) {
        const [key, val] = part.split('=');
        if (!key || !val) continue;

        if (key === 'FREQ') {
            freq = val as 'WEEKLY' | 'MONTHLY';
        } else if (key === 'INTERVAL') {
            interval = parseInt(val, 10) || 1;
        } else if (key === 'BYDAY') {
            const days = val.split(',');
            if (freq === 'WEEKLY') {
                selectedDays = days;
            } else {
                const daysSet = new Set<string>();
                const weeksSet = new Set<string>();
                for (const d of days) {
                    const week = d.match(/^[0-9]+/)?.[0] || '';
                    const day = d.replace(/^[0-9]+/, '');
                    if (week) weeksSet.add(week);
                    if (day) daysSet.add(day);
                }
                selectedDays = Array.from(daysSet);
                selectedWeeks = Array.from(weeksSet);
            }
        }
    }
    return { freq, interval, selectedDays, selectedWeeks };
};

const DAYS_OF_WEEK = [
    { label: '月', value: 'MO' }, { label: '火', value: 'TU' }, { label: '水', value: 'WE' },
    { label: '木', value: 'TH' }, { label: '金', value: 'FR' }, { label: '土', value: 'SA' }, { label: '日', value: 'SU' }
];

const WEEKS_OF_MONTH = [
    { label: '第1', value: '1' }, { label: '第2', value: '2' }, { label: '第3', value: '3' },
    { label: '第4', value: '4' }, { label: '第5', value: '5' }
];

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = { PaperProps: { style: { maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP, width: 250 } } };

export const ShiftPatternModal = ({ open, onClose, onSave, clients, staffs, organizationId, initialData }: Props) => {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [clientId, setClientId] = useState('');
    const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
    const [startTime, setStartTime] = useState('10:00');
    const [endTime, setEndTime] = useState('12:00');

    const [freq, setFreq] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
    const [interval, setIntervalCount] = useState<number>(1);
    const [selectedDays, setSelectedDays] = useState<string[]>([]);
    const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);

    useEffect(() => {
        if (open) {
            if (initialData) {
                setClientId(initialData.client_id || '');
                setSelectedStaffIds((initialData.shift_pattern_staffs || []).map((s) => s.staff_id));
                setStartTime(initialData.start_time ? initialData.start_time.slice(0, 5) : '10:00');
                setEndTime(initialData.end_time ? initialData.end_time.slice(0, 5) : '12:00');

                const parsed = parseRrule(initialData.rrule || '');
                setFreq(parsed.freq);
                setIntervalCount(parsed.interval);
                setSelectedDays(parsed.selectedDays);
                setSelectedWeeks(parsed.selectedWeeks);
            } else {
                setClientId('');
                setSelectedStaffIds([]);
                setStartTime('10:00');
                setEndTime('12:00');
                setFreq('WEEKLY');
                setIntervalCount(1);
                setSelectedDays([]);
                setSelectedWeeks([]);
            }
        }
    }, [open, initialData]);

    const handleSave = async () => {
        if (!clientId || !startTime || !endTime || selectedStaffIds.length === 0 || selectedDays.length === 0) {
            showToast('必須項目（利用者、担当スタッフ、時間、繰り返し条件）をすべて指定してください', 'warning');
            return;
        }

        let rruleStr = '';
        if (freq === 'WEEKLY') {
            rruleStr = `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${selectedDays.join(',')}`;
        } else {
            if (selectedWeeks.length === 0) {
                showToast('第何週に展開するか指定してください', 'warning');
                return;
            }
            const byDayParams = selectedWeeks.flatMap(week => selectedDays.map(day => `${week}${day}`));
            rruleStr = `FREQ=MONTHLY;BYDAY=${byDayParams.join(',')}`;
        }

        setLoading(true);
        try {
            const clientName = clients.find(c => c.id === clientId)?.name || '';
            const staffNames = staffs.filter(s => selectedStaffIds.includes(s.id)).map(s => s.name).join(', ');

            await onSave({
                organizationId,
                clientId,
                title: `${clientName} (${staffNames})`,
                startTime: startTime.length === 5 ? `${startTime}:00` : startTime,
                endTime: endTime.length === 5 ? `${endTime}:00` : endTime,
                rrule: rruleStr,
                staffIds: selectedStaffIds
            }, initialData?.id);
            onClose();
        } catch (e) {
            console.error(e);
            showToast('ひな形の保存に失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleStaffChange = (event: SelectChangeEvent<typeof selectedStaffIds>) => {
        const { target: { value } } = event;
        setSelectedStaffIds(typeof value === 'string' ? value.split(',') : value);
    };

    const toggleArrayItem = (array: string[], setArray: (val: string[]) => void, item: string) => {
        if (array.includes(item)) setArray(array.filter(i => i !== item));
        else setArray([...array, item]);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableEscapeKeyDown>
            <DialogTitle sx={{ fontWeight: 'bold' }}>
                {initialData ? '基本パターン（ひな形）の編集' : '基本パターン（ひな形）の登録'}
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                    <FormControl fullWidth size="small" required>
                        <InputLabel>利用者</InputLabel>
                        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} label="利用者">
                            {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth size="small" required>
                        <InputLabel>担当スタッフ（複数選択可）</InputLabel>
                        <Select
                            multiple
                            value={selectedStaffIds}
                            onChange={handleStaffChange}
                            input={<OutlinedInput label="担当スタッフ（複数選択可）" />}
                            renderValue={(selected) => (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {selected.map((value) => {
                                        const staff = staffs.find(s => s.id === value);
                                        return <Chip key={value} label={staff?.name || ''} size="small" />;
                                    })}
                                </Box>
                            )}
                            MenuProps={MenuProps}
                        >
                            {staffs.map(s => (
                                <MenuItem key={s.id} value={s.id}>
                                    <Checkbox checked={selectedStaffIds.indexOf(s.id) > -1} size="small" />
                                    <Typography variant="body2" sx={{ fontWeight: selectedStaffIds.includes(s.id) ? 'bold' : 'normal' }}>
                                        {s.name}
                                    </Typography>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Stack direction="row" spacing={2}>
                        <TextField
                            label="開始時間"
                            type="time"
                            fullWidth
                            size="small"
                            required
                            InputLabelProps={{ shrink: true }}
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                        />
                        <TextField
                            label="終了時間"
                            type="time"
                            fullWidth
                            size="small"
                            required
                            InputLabelProps={{ shrink: true }}
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                        />
                    </Stack>

                    <Box p={2.5} border="1px solid" borderColor="divider" borderRadius={2} bgcolor="background.subtle">
                        <Typography variant="subtitle2" fontWeight="bold" mb={2}>繰り返しのスケジュール設定</Typography>
                        <Stack spacing={2.5}>
                            <Stack direction="row" spacing={2}>
                                <FormControl size="small" sx={{ flexGrow: 1 }}>
                                    <Select value={freq} onChange={(e) => setFreq(e.target.value as 'WEEKLY' | 'MONTHLY')}>
                                        <MenuItem value="WEEKLY">毎週繰り返し</MenuItem>
                                        <MenuItem value="MONTHLY">毎月（第○・曜日指定）</MenuItem>
                                    </Select>
                                </FormControl>
                                {freq === 'WEEKLY' && (
                                    <FormControl size="small" sx={{ width: 140 }}>
                                        <Select value={interval} onChange={(e) => setIntervalCount(Number(e.target.value))}>
                                            <MenuItem value={1}>毎週</MenuItem>
                                            <MenuItem value={2}>2週間に1回</MenuItem>
                                            <MenuItem value={3}>3週間に1回</MenuItem>
                                            <MenuItem value={4}>4週間に1回</MenuItem>
                                        </Select>
                                    </FormControl>
                                )}
                            </Stack>

                            {freq === 'MONTHLY' && (
                                <Box>
                                    <Typography variant="caption" color="text.secondary" fontWeight="bold">該当する週を選択</Typography>
                                    <FormGroup row>
                                        {WEEKS_OF_MONTH.map(w => (
                                            <FormControlLabel
                                                key={w.value}
                                                control={<Checkbox size="small" checked={selectedWeeks.includes(w.value)} onChange={() => toggleArrayItem(selectedWeeks, setSelectedWeeks, w.value)} />}
                                                label={w.label}
                                            />
                                        ))}
                                    </FormGroup>
                                </Box>
                            )}
                            <Box>
                                <Typography variant="caption" color="text.secondary" fontWeight="bold">曜日を選択（複数指定可）</Typography>
                                <FormGroup row>
                                    {DAYS_OF_WEEK.map(d => (
                                        <FormControlLabel
                                            key={d.value}
                                            control={<Checkbox size="small" checked={selectedDays.includes(d.value)} onChange={() => toggleArrayItem(selectedDays, setSelectedDays, d.value)} />}
                                            label={d.label}
                                        />
                                    ))}
                                </FormGroup>
                            </Box>
                        </Stack>
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2, px: 3 }}>
                <Button onClick={onClose} color="inherit" disabled={loading}>閉じる</Button>
                <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={loading}
                    sx={{ boxShadow: 'none', px: 3 }}
                >
                    {loading ? <CircularProgress size={24} color="inherit" /> : (initialData ? '設定を保存' : 'ひな形を登録')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};