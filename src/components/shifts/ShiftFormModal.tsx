'use client';

import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Stack, FormControl, InputLabel,
    Select, MenuItem, Box, Typography, Switch, FormControlLabel,
    Checkbox, FormGroup, CircularProgress
} from '@mui/material';
import { ShiftPayload } from '@/app/actions/shift';

export type ClientData = { id: string; name: string };
export type StaffData = { id: string; name: string; type: 'member' | 'ghost' };

// 既存のシフトデータを受け取るための型
export type ShiftData = {
    id: string;
    organization_id: string;
    client_id: string;
    title: string | null;
    start_at: string;
    end_at: string;
    is_recurring: boolean;
    rrule: string | null;
    status: string;
    cancel_reason: string | null;
    shift_staffs: {
        user_id: string | null;
        ghost_staff_id: string | null;
    }[];
};

type Props = {
    open: boolean;
    onClose: () => void;
    onSave: (payload: ShiftPayload, shiftId?: string) => Promise<void>;
    onCancelShift?: (shiftId: string, reason: string) => Promise<void>;
    clients: ClientData[];
    staffs: StaffData[];
    organizationId: string;
    initialData?: ShiftData | null;
};

const DAYS_OF_WEEK = [
    { label: '月', value: 'MO' }, { label: '火', value: 'TU' }, { label: '水', value: 'WE' },
    { label: '木', value: 'TH' }, { label: '金', value: 'FR' }, { label: '土', value: 'SA' }, { label: '日', value: 'SU' }
];

const WEEKS_OF_MONTH = [
    { label: '第1', value: '1' }, { label: '第2', value: '2' }, { label: '第3', value: '3' },
    { label: '第4', value: '4' }, { label: '第5', value: '5' }
];

export const ShiftFormModal = ({ open, onClose, onSave, onCancelShift, clients, staffs, organizationId, initialData }: Props) => {
    const [loading, setLoading] = useState(false);
    
    // フォームステート
    const [clientId, setClientId] = useState('');
    const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [isRecurring, setIsRecurring] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    
    // 繰り返しルールのステート
    const [freq, setFreq] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
    const [selectedDays, setSelectedDays] = useState<string[]>([]);
    const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);

    useEffect(() => {
        if (open) {
            if (initialData) {
                // 編集時の初期化
                setClientId(initialData.client_id);
                setStartAt(initialData.start_at.slice(0, 16)); // YYYY-MM-DDThh:mm にフォーマット
                setEndAt(initialData.end_at.slice(0, 16));
                setIsRecurring(initialData.is_recurring);
                setCancelReason(initialData.cancel_reason || '');
                
                const staffIds = initialData.shift_staffs.map(s => s.user_id || s.ghost_staff_id).filter((id): id is string => id !== null);
                setSelectedStaffIds(staffIds);

                // RRULEのパース (簡易版: 複雑なUI復元は今回は省略し、基本情報のみ復元)
                if (initialData.rrule) {
                    if (initialData.rrule.includes('FREQ=MONTHLY')) setFreq('MONTHLY');
                    else setFreq('WEEKLY');
                }
            } else {
                // 新規作成時の初期化
                setClientId('');
                setSelectedStaffIds([]);
                setStartAt('');
                setEndAt('');
                setIsRecurring(false);
                setFreq('WEEKLY');
                setSelectedDays([]);
                setSelectedWeeks([]);
                setCancelReason('');
            }
        }
    }, [open, initialData]);

    const handleSave = async () => {
        if (!clientId || !startAt || !endAt || selectedStaffIds.length === 0) {
            alert('必須項目を入力してください');
            return;
        }

        setLoading(true);

        try {
            const clientName = clients.find(c => c.id === clientId)?.name || '';
            const staffNames = staffs.filter(s => selectedStaffIds.includes(s.id)).map(s => s.name).join(', ');
            const title = `${clientName} (${staffNames})`;

            const staffIds = staffs.filter(s => selectedStaffIds.includes(s.id) && s.type === 'member').map(s => s.id);
            const ghostStaffIds = staffs.filter(s => selectedStaffIds.includes(s.id) && s.type === 'ghost').map(s => s.id);

            // RRULE文字列の生成
            let rruleStr: string | undefined = undefined;
            if (isRecurring) {
                if (freq === 'WEEKLY' && selectedDays.length > 0) {
                    rruleStr = `FREQ=WEEKLY;BYDAY=${selectedDays.join(',')}`;
                } else if (freq === 'MONTHLY' && selectedDays.length > 0 && selectedWeeks.length > 0) {
                    // 例: 第1,3土曜日 -> BYDAY=1SA,3SA
                    const byDayParams = selectedWeeks.flatMap(week => selectedDays.map(day => `${week}${day}`));
                    rruleStr = `FREQ=MONTHLY;BYDAY=${byDayParams.join(',')}`;
                }
            }

            const payload: ShiftPayload = {
                organizationId,
                clientId,
                title,
                startAt: new Date(startAt).toISOString(),
                endAt: new Date(endAt).toISOString(),
                isRecurring,
                rrule: rruleStr,
                staffIds,
                ghostStaffIds,
            };

            await onSave(payload, initialData?.id);
            onClose();
        } catch (error) {
            console.error(error);
            alert('保存に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleCancelShift = async () => {
        if (!initialData || !onCancelShift) return;
        if (!confirm('このシフトをキャンセル（お休み）扱いにしますか？')) return;
        
        setLoading(true);
        try {
            await onCancelShift(initialData.id, cancelReason);
            onClose();
        } catch (error) {
            console.error(error);
            alert('キャンセルの処理に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const toggleArrayItem = (array: string[], setArray: (val: string[]) => void, item: string) => {
        if (array.includes(item)) setArray(array.filter(i => i !== item));
        else setArray([...array, item]);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableEscapeKeyDown>
            <DialogTitle fontWeight="bold">
                {initialData ? 'シフトの編集' : 'シフトの新規登録'}
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                    {initialData?.status === 'cancelled' && (
                        <Box p={2} bgcolor="#ffebee" borderRadius={1}>
                            <Typography color="error" fontWeight="bold">このシフトはキャンセルされています</Typography>
                            <Typography variant="body2" color="error">理由: {initialData.cancel_reason || 'なし'}</Typography>
                        </Box>
                    )}

                    <FormControl fullWidth size="small" required>
                        <InputLabel>利用者</InputLabel>
                        <Select value={clientId} onChange={(e) => setClientId(e.target.value as string)} label="利用者">
                            {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth size="small" required>
                        <InputLabel>担当スタッフ（複数選択可）</InputLabel>
                        <Select 
                            multiple 
                            value={selectedStaffIds} 
                            onChange={(e) => setSelectedStaffIds(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)} 
                            label="担当スタッフ（複数選択可）"
                        >
                            {staffs.map(s => <MenuItem key={s.id} value={s.id}>{s.name} {s.type === 'ghost' ? '(転記)' : ''}</MenuItem>)}
                        </Select>
                    </FormControl>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                            label="開始日時"
                            type="datetime-local"
                            fullWidth
                            size="small"
                            required
                            InputLabelProps={{ shrink: true }}
                            value={startAt}
                            onChange={(e) => setStartAt(e.target.value)}
                        />
                        <TextField
                            label="終了日時"
                            type="datetime-local"
                            fullWidth
                            size="small"
                            required
                            InputLabelProps={{ shrink: true }}
                            value={endAt}
                            onChange={(e) => setEndAt(e.target.value)}
                        />
                    </Stack>

                    {!initialData && (
                        <Box p={2} border="1px solid #e0e0e0" borderRadius={2}>
                            <FormControlLabel
                                control={<Switch checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} color="primary" />}
                                label={<Typography fontWeight="bold">繰り返し設定</Typography>}
                            />
                            {isRecurring && (
                                <Stack spacing={2} mt={2}>
                                    <FormControl size="small">
                                        <Select value={freq} onChange={(e) => setFreq(e.target.value as 'WEEKLY' | 'MONTHLY')}>
                                            <MenuItem value="WEEKLY">毎週</MenuItem>
                                            <MenuItem value="MONTHLY">毎月（第○曜日指定）</MenuItem>
                                        </Select>
                                    </FormControl>

                                    {freq === 'MONTHLY' && (
                                        <Box>
                                            <Typography variant="caption" color="text.secondary">週を選択</Typography>
                                            <FormGroup row>
                                                {WEEKS_OF_MONTH.map(w => (
                                                    <FormControlLabel key={w.value} control={<Checkbox size="small" checked={selectedWeeks.includes(w.value)} onChange={() => toggleArrayItem(selectedWeeks, setSelectedWeeks, w.value)} />} label={w.label} />
                                                ))}
                                            </FormGroup>
                                        </Box>
                                    )}

                                    <Box>
                                        <Typography variant="caption" color="text.secondary">曜日を選択</Typography>
                                        <FormGroup row>
                                            {DAYS_OF_WEEK.map(d => (
                                                <FormControlLabel key={d.value} control={<Checkbox size="small" checked={selectedDays.includes(d.value)} onChange={() => toggleArrayItem(selectedDays, setSelectedDays, d.value)} />} label={d.label} />
                                            ))}
                                        </FormGroup>
                                    </Box>
                                </Stack>
                            )}
                        </Box>
                    )}

                    {initialData && initialData.status !== 'cancelled' && (
                        <Box p={2} border="1px solid #ffcdd2" borderRadius={2} bgcolor="#fffafb">
                            <Typography variant="subtitle2" color="error" gutterBottom fontWeight="bold">キャンセルの処理</Typography>
                            <Stack direction="row" spacing={1}>
                                <TextField 
                                    size="small" 
                                    fullWidth 
                                    placeholder="キャンセル理由（利用者入院、など）" 
                                    value={cancelReason}
                                    onChange={(e) => setCancelReason(e.target.value)}
                                />
                                <Button variant="outlined" color="error" onClick={handleCancelShift} disabled={loading}>
                                    キャンセルにする
                                </Button>
                            </Stack>
                        </Box>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit" disabled={loading}>閉じる</Button>
                <Button variant="contained" onClick={handleSave} disabled={loading}>
                    {loading ? <CircularProgress size={24} color="inherit" /> : '保存する'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};