'use client';

import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Stack, FormControl, InputLabel,
    Select, MenuItem, Box, Typography, CircularProgress, Chip, OutlinedInput,
    SelectChangeEvent
} from '@mui/material';
import { ShiftPayload } from '@/app/actions/shift';

export type ClientData = { id: string; name: string };
export type StaffData = { id: string; name: string };

export type ShiftData = {
    id: string;
    client_id: string;
    title: string | null;
    start_at: string;
    end_at: string;
    status: string;
    cancel_reason: string | null;
    shift_staffs: { staff_id: string; }[];
};

type Props = {
    open: boolean;
    onClose: () => void;
    onSave: (payload: ShiftPayload, shiftId?: string) => Promise<void>;
    onToggleCancel?: (shiftId: string, isCancel: boolean, reason: string) => Promise<void>;
    clients: ClientData[];
    staffs: StaffData[];
    organizationId: string;
    initialData?: ShiftData | null;
};

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = { PaperProps: { style: { maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP, width: 250 } } };

export const ShiftFormModal = ({ open, onClose, onSave, onToggleCancel, clients, staffs, organizationId, initialData }: Props) => {
    const [loading, setLoading] = useState(false);
    
    const [clientId, setClientId] = useState('');
    const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [cancelReason, setCancelReason] = useState('');

    useEffect(() => {
        if (open) {
            if (initialData) {
                setClientId(initialData.client_id);
                setStartAt(initialData.start_at.slice(0, 16)); 
                setEndAt(initialData.end_at.slice(0, 16));
                setCancelReason(initialData.cancel_reason || '');
                setSelectedStaffIds(initialData.shift_staffs.map(s => s.staff_id));
            } else {
                setClientId(''); setSelectedStaffIds([]); setStartAt(''); setEndAt(''); setCancelReason('');
            }
        }
    }, [open, initialData]);

    const handleSave = async () => {
        if (!clientId || !startAt || !endAt || selectedStaffIds.length === 0) {
            alert('必須項目を入力してください'); return;
        }
        setLoading(true);
        try {
            const clientName = clients.find(c => c.id === clientId)?.name || '';
            const staffNames = staffs.filter(s => selectedStaffIds.includes(s.id)).map(s => s.name).join(', ');
            const payload: ShiftPayload = {
                organizationId, clientId, title: `${clientName} (${staffNames})`,
                startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(),
                staffIds: selectedStaffIds,
            };
            await onSave(payload, initialData?.id);
            onClose();
        } catch (error) { console.error(error); alert('保存に失敗しました'); } finally { setLoading(false); }
    };

    const handleToggleCancel = async (isCancel: boolean) => {
        if (!initialData || !onToggleCancel) return;
        const msg = isCancel ? 'このシフトをお休み（キャンセル）扱いにしますか？' : 'キャンセルを取り消して稼働中に戻しますか？';
        if (!confirm(msg)) return;
        
        setLoading(true);
        try {
            await onToggleCancel(initialData.id, isCancel, cancelReason);
            onClose();
        } catch (error) { console.error(error); alert('処理に失敗しました'); } finally { setLoading(false); }
    };

    const handleStaffChange = (event: SelectChangeEvent<typeof selectedStaffIds>) => {
        const { target: { value } } = event;
        setSelectedStaffIds(typeof value === 'string' ? value.split(',') : value);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableEscapeKeyDown>
            <DialogTitle fontWeight="bold">{initialData ? '単発シフトの編集' : '単発シフトの追加'}</DialogTitle>
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
                        <Select multiple value={selectedStaffIds} onChange={handleStaffChange} input={<OutlinedInput label="担当スタッフ（複数選択可）" />} renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                {selected.map((value) => { const staff = staffs.find(s => s.id === value); return <Chip key={value} label={staff?.name || ''} size="small" />; })}
                            </Box>
                        )} MenuProps={MenuProps}>
                            {staffs.map(s => (
                                <MenuItem key={s.id} value={s.id}>
                                    <Typography variant="body2" sx={{ fontWeight: selectedStaffIds.includes(s.id) ? 'bold' : 'normal' }}>{s.name}</Typography>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField label="開始日時" type="datetime-local" fullWidth size="small" required InputLabelProps={{ shrink: true }} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                        <TextField label="終了日時" type="datetime-local" fullWidth size="small" required InputLabelProps={{ shrink: true }} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                    </Stack>

                    {initialData && (
                        <Box p={2} border="1px solid #ffcdd2" borderRadius={2} bgcolor="#fffafb">
                            <Typography variant="subtitle2" color="error" gutterBottom fontWeight="bold">休みの管理</Typography>
                            {initialData.status === 'cancelled' ? (
                                <Button variant="contained" color="success" onClick={() => handleToggleCancel(false)} disabled={loading} fullWidth sx={{ boxShadow: 'none' }}>
                                    キャンセルを取り消す（復元）
                                </Button>
                            ) : (
                                <Stack direction="row" spacing={1}>
                                    <TextField size="small" fullWidth placeholder="理由（利用者入院など）" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                                    <Button variant="outlined" color="error" onClick={() => handleToggleCancel(true)} disabled={loading} sx={{ minWidth: 140 }}>休みにする</Button>
                                </Stack>
                            )}
                        </Box>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit" disabled={loading}>閉じる</Button>
                <Button variant="contained" onClick={handleSave} disabled={loading} sx={{ boxShadow: 'none' }}>{loading ? <CircularProgress size={24} color="inherit" /> : '保存する'}</Button>
            </DialogActions>
        </Dialog>
    );
};