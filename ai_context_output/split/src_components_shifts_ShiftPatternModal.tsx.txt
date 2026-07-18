'use client';

import React, { useState, useEffect } from 'react';
import {
    Stack, FormControl,
    Select, MenuItem, Box, Typography, Checkbox, FormGroup,
    FormControlLabel, IconButton, Tooltip, InputLabel, Button, Chip
} from '@/components/ui/mui';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { ShiftPatternPayload, type ShiftPatternSegmentInput } from '@/app/actions/shift';
import { getServiceTypes, type ServiceType } from '@/app/actions/serviceTypes';
import { getStaffRoles, type StaffRole } from '@/app/actions/staffRoles';
import { ClientData, StaffData } from './ShiftFormModal';
import { useToast } from '@/components/ui/ToastProvider';
import { AppButton, AppDialog, DateTimeField, SelectField } from '@/components/ui';

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
        shift_pattern_segments?: {
            id: string;
            service_type_id: string | null;
            start_time: string;
            end_time: string;
            sort_order: number;
            shift_pattern_segment_staffs: { staff_id: string; staff_role_id: string | null }[];
        }[];
    } | null;
};

type SegmentDraft = {
    service_type_id: string;
    start_time: string;
    end_time: string;
    staffs: { staff_id: string; staff_role_id: string }[];
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

const normalizeTimeInput = (time: string) => time ? time.slice(0, 5) : '';

const toPayloadTime = (time: string) => time.length === 5 ? `${time}:00` : time;

export const ShiftPatternModal = ({ open, onClose, onSave, clients, staffs, organizationId, initialData }: Props) => {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
    const [staffRoles, setStaffRoles] = useState<StaffRole[]>([]);
    const [clientId, setClientId] = useState('');
    const [startTime, setStartTime] = useState('10:00');
    const [endTime, setEndTime] = useState('12:00');
    const [segments, setSegments] = useState<SegmentDraft[]>([]);

    const [freq, setFreq] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
    const [interval, setIntervalCount] = useState<number>(1);
    const [selectedDays, setSelectedDays] = useState<string[]>([]);
    const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
    const [autoAssign, setAutoAssign] = useState(true);

    useEffect(() => {
        if (open) {
            Promise.all([getServiceTypes(organizationId), getStaffRoles(organizationId)])
                .then(([types, roles]) => {
                    setServiceTypes(types.filter(t => t.is_active));
                    setStaffRoles(roles.filter(r => r.is_active));
                })
                .catch((error) => {
                    console.error(error);
                    showToast('区間設定の選択肢を読み込めませんでした', 'error');
                });
            queueMicrotask(() => {
              if (initialData) {
                setClientId(initialData.client_id || '');
                setStartTime(initialData.start_time ? initialData.start_time.slice(0, 5) : '10:00');
                setEndTime(initialData.end_time ? initialData.end_time.slice(0, 5) : '12:00');
                const loadedSegments = (initialData.shift_pattern_segments ?? [])
                    .slice()
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((segment) => ({
                        service_type_id: segment.service_type_id ?? '',
                        start_time: normalizeTimeInput(segment.start_time),
                        end_time: normalizeTimeInput(segment.end_time),
                        staffs: (segment.shift_pattern_segment_staffs ?? []).map((staff) => ({
                            staff_id: staff.staff_id,
                            staff_role_id: staff.staff_role_id ?? '',
                        })),
                    }));
                setSegments(loadedSegments);

                const parsed = parseRrule(initialData.rrule || '');
                setFreq(parsed.freq);
                setIntervalCount(parsed.interval);
                setSelectedDays(parsed.selectedDays);
                setSelectedWeeks(parsed.selectedWeeks);
              } else {
                setClientId('');
                setStartTime('10:00');
                setEndTime('12:00');
                setSegments([]);
                setFreq('WEEKLY');
                setIntervalCount(1);
                setSelectedDays([]);
                setSelectedWeeks([]);
                setAutoAssign(true);
              }
            });
        }
    }, [open, initialData, organizationId, showToast]);

    const handleSave = async () => {
        if (segments.length === 0) {
            showToast('サービス区間を1つ以上追加してください', 'warning');
            return;
        }
        if (segments.some(s => s.staffs.filter(st => st.staff_id).length === 0)) {
            showToast('すべてのサービス区間に担当スタッフを設定してください', 'warning');
            return;
        }

        if (!clientId || !startTime || !endTime || selectedDays.length === 0) {
            showToast('必須項目（利用者、時間、繰り返し条件）をすべて指定してください', 'warning');
            return;
        }
        if (segments.some((segment) => !segment.start_time || !segment.end_time)) {
            showToast('各区間の時間を指定してください', 'warning');
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
            const segmentStaffIds = Array.from(new Set(segments.flatMap((segment) => segment.staffs.map((staff) => staff.staff_id).filter(Boolean))));
            const staffNames = staffs.filter(s => segmentStaffIds.includes(s.id)).map(s => s.name).join(', ');
            const payloadSegments: ShiftPatternSegmentInput[] = segments.map((segment, index) => ({
                service_type_id: segment.service_type_id || null,
                start_time: toPayloadTime(segment.start_time),
                end_time: toPayloadTime(segment.end_time),
                sort_order: index,
                staffs: segment.staffs
                    .filter((staff) => Boolean(staff.staff_id))
                    .map((staff) => ({
                        staff_id: staff.staff_id,
                        staff_role_id: staff.staff_role_id || null,
                    })),
            }));

            await onSave({
                organizationId,
                clientId,
                title: `${clientName} (${staffNames})`,
                startTime: startTime.length === 5 ? `${startTime}:00` : startTime,
                endTime: endTime.length === 5 ? `${endTime}:00` : endTime,
                rrule: rruleStr,
                segments: payloadSegments,
                autoAssign: !initialData ? autoAssign : false,
            }, initialData?.id);
            onClose();
        } catch (e) {
            console.error(e);
            showToast('ひな形の保存に失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleArrayItem = (array: string[], setArray: (val: string[]) => void, item: string) => {
        if (array.includes(item)) setArray(array.filter(i => i !== item));
        else setArray([...array, item]);
    };

    const updateSegment = (idx: number, patch: Partial<SegmentDraft>) => {
        setSegments(prev => prev.map((segment, index) => index === idx ? { ...segment, ...patch } : segment));
    };

    const addSegment = () => {
        setSegments(prev => [
            ...prev,
            {
                service_type_id: '',
                start_time: prev.length > 0 ? prev[prev.length - 1].end_time : startTime,
                end_time: endTime,
                staffs: [],
            },
        ]);
    };

    const removeSegment = (idx: number) => {
        setSegments(prev => prev.filter((_, index) => index !== idx));
    };

    return (
        <AppDialog
            open={open}
            onClose={onClose}
            disableEscapeKeyDown
            loading={loading}
            title={initialData ? '基本パターン（ひな形）の編集' : '基本パターン（ひな形）の登録'}
            actions={<><AppButton variant="text" intent="secondary" onClick={onClose} disabled={loading}>閉じる</AppButton><AppButton onClick={handleSave} loading={loading}>{initialData ? '設定を保存' : 'ひな形を登録'}</AppButton></>}
        >
                <Stack spacing={3}>
                    <SelectField
                        required
                        label="利用者"
                        value={clientId}
                        options={clients.map((client) => ({ value: client.id, label: client.name }))}
                        onChange={setClientId}
                    />

                    {/* 新規作成時のみ: 自動アサインチェックボックス */}
                    {!initialData && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={autoAssign}
                                    onChange={(e) => setAutoAssign(e.target.checked)}
                                    size="small"
                                />
                            }
                            label={
                                <Typography variant="body2" color="text.secondary">
                                    区間スタッフを基本担当（担当スタッフ設定）にも登録する
                                </Typography>
                            }
                        />
                    )}

                    <Stack direction="row" spacing={2}>
                        <DateTimeField
                            kind="time"
                            label="開始時間"
                            fullWidth
                            size="small"
                            required
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                        />
                        <DateTimeField
                            kind="time"
                            label="終了時間"
                            fullWidth
                            size="small"
                            required
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                        />
                    </Stack>

                    <Box p={2.5} border="1px solid" borderColor="divider" borderRadius={2} bgcolor="background.subtle">
                        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
                            <Typography variant="subtitle2" fontWeight="bold">サービス区間 <Typography component="span" variant="caption" color="error">*</Typography></Typography>
                            <Button size="small" startIcon={<AddIcon />} onClick={addSegment}>
                                区間を追加
                            </Button>
                        </Stack>
                        <Stack spacing={2}>
                            {segments.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">
                                    「区間を追加」ボタンでサービス区間とスタッフを設定してください。
                                </Typography>
                            ) : segments.map((seg, idx) => (
                                <Box key={idx} p={2} border="1px solid" borderColor="divider" borderRadius={1.5} bgcolor="background.paper">
                                    <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
                                        <Typography variant="caption" fontWeight="bold">区間 {idx + 1}</Typography>
                                        <Tooltip title="この区間を削除">
                                            <span>
                                                <IconButton size="small" color="error" onClick={() => removeSegment(idx)} disabled={segments.length <= 1}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </Stack>

                                    <Stack spacing={1.5}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel>サービス種別</InputLabel>
                                            <Select
                                                label="サービス種別"
                                                value={seg.service_type_id}
                                                onChange={(e) => updateSegment(idx, { service_type_id: e.target.value })}
                                            >
                                                <MenuItem value=""><em>未設定</em></MenuItem>
                                                {serviceTypes.map((type) => (
                                                    <MenuItem key={type.id} value={type.id}>{type.name}</MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>

                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                            <DateTimeField
                                                kind="time"
                                                label="区間開始"
                                                fullWidth
                                                size="small"
                                                value={seg.start_time}
                                                onChange={(e) => updateSegment(idx, { start_time: e.target.value })}
                                            />
                                            <DateTimeField
                                                kind="time"
                                                label="区間終了"
                                                fullWidth
                                                size="small"
                                                value={seg.end_time}
                                                onChange={(e) => updateSegment(idx, { end_time: e.target.value })}
                                            />
                                        </Stack>

                                        <Box>
                                            <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                                スタッフと役割
                                            </Typography>
                                            <Stack spacing={1}>
                                                {seg.staffs.map((staff, staffIdx) => (
                                                    <Stack key={staffIdx} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                                                        <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                                                            <InputLabel>スタッフ</InputLabel>
                                                            <Select
                                                                label="スタッフ"
                                                                value={staff.staff_id}
                                                                onChange={(e) => {
                                                                    const next = [...seg.staffs];
                                                                    next[staffIdx] = { ...next[staffIdx], staff_id: e.target.value };
                                                                    updateSegment(idx, { staffs: next });
                                                                }}
                                                            >
                                                                {staffs.map((option) => (
                                                                    <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                                                                ))}
                                                            </Select>
                                                        </FormControl>
                                                        <FormControl size="small" sx={{ minWidth: 150, flex: 1 }}>
                                                            <InputLabel>役割</InputLabel>
                                                            <Select
                                                                label="役割"
                                                                value={staff.staff_role_id}
                                                                onChange={(e) => {
                                                                    const next = [...seg.staffs];
                                                                    next[staffIdx] = { ...next[staffIdx], staff_role_id: e.target.value };
                                                                    updateSegment(idx, { staffs: next });
                                                                }}
                                                            >
                                                                <MenuItem value=""><em>未設定</em></MenuItem>
                                                                {staffRoles.map((role) => (
                                                                    <MenuItem key={role.id} value={role.id}>
                                                                        {role.name}{role.is_unpaid && <Chip size="small" label="無給" color="warning" variant="outlined" sx={{ ml: 0.5, height: 16, fontSize: '0.65rem' }} />}
                                                                    </MenuItem>
                                                                ))}
                                                            </Select>
                                                        </FormControl>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => updateSegment(idx, { staffs: seg.staffs.filter((_, index) => index !== staffIdx) })}
                                                        >
                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </Stack>
                                                ))}
                                                <Button
                                                    size="small"
                                                    startIcon={<AddIcon />}
                                                    onClick={() => updateSegment(idx, { staffs: [...seg.staffs, { staff_id: '', staff_role_id: '' }] })}
                                                    sx={{ alignSelf: 'flex-start' }}
                                                >
                                                    スタッフを追加
                                                </Button>
                                            </Stack>
                                        </Box>
                                    </Stack>
                                </Box>
                            ))}
                        </Stack>
                    </Box>

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
        </AppDialog>
    );
};
