'use client';
import { tokens } from '@/styles/tokens';

import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Stack, FormControl, InputLabel,
    Select, MenuItem, Box, Typography, CircularProgress, Chip, OutlinedInput,
    SelectChangeEvent, IconButton, Tooltip, Divider
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
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
    onDelete?: (shiftId: string) => Promise<void>;
    clients: ClientData[];
    staffs: StaffData[];
    organizationId: string;
    initialData?: ShiftData | null;
};

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = { PaperProps: { style: { maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP, width: 250 } } };

export const ShiftFormModal = ({
    open, onClose, onSave, onToggleCancel, onDelete, clients, staffs, organizationId, initialData
}: Props) => {
    const [loading, setLoading] = useState(false);

    const [clientId, setClientId] = useState('');
    const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [cancelReason, setCancelReason] = useState('');

    useEffect(() => {
        if (open) {
            if (initialData) {
                setClientId(initialData.client_id || '');
                // YYYY-MM-DDTHH:mm の形にフォーマットしてdatetime-localに安全に適用
                const formatDatetime = (isoStr: string) => {
                    if (!isoStr) return '';
                    const d = new Date(isoStr);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                };
                setStartAt(formatDatetime(initialData.start_at));
                setEndAt(formatDatetime(initialData.end_at));
                setCancelReason(initialData.cancel_reason || '');
                setSelectedStaffIds((initialData.shift_staffs || []).map(s => s.staff_id));
            } else {
                setClientId('');
                setSelectedStaffIds([]);
                setStartAt('');
                setEndAt('');
                setCancelReason('');
            }
        }
    }, [open, initialData]);

    const handleSave = async () => {
        if (!clientId || !startAt || !endAt || selectedStaffIds.length === 0) {
            alert('必須項目（利用者、スタッフ、日時）をすべて入力してください');
            return;
        }
        setLoading(true);
        try {
            const clientName = clients.find(c => c.id === clientId)?.name || '';
            const staffNames = staffs.filter(s => selectedStaffIds.includes(s.id)).map(s => s.name).join(', ');

            const payload: ShiftPayload = {
                organizationId,
                clientId,
                title: `${clientName} (${staffNames})`,
                startAt: new Date(startAt).toISOString(),
                endAt: new Date(endAt).toISOString(),
                staffIds: selectedStaffIds,
                isModified: true // 手動で保存したため「個別調整済み」フラグを立てる
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

    const handleToggleCancel = async (isCancel: boolean) => {
        if (!initialData || !onToggleCancel) return;

        const confirmMsg = isCancel
            ? 'この予定を「お休み（キャンセル）」扱いに変更しますか？'
            : 'キャンセルを取り消して、通常の稼働予定に復元しますか？';

        if (!confirm(confirmMsg)) return;

        setLoading(true);
        try {
            await onToggleCancel(initialData.id, isCancel, cancelReason);
            onClose();
        } catch (error) {
            console.error(error);
            alert('処理に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!initialData || !onDelete) return;
        if (!confirm('このシフトをカレンダーから完全に削除しますか？\n※この操作は取り消せません。Googleカレンダーからも完全に消去されます。')) return;

        setLoading(true);
        try {
            await onDelete(initialData.id);
            onClose();
        } catch (error) {
            console.error(error);
            alert('削除に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleStaffChange = (event: SelectChangeEvent<typeof selectedStaffIds>) => {
        const { target: { value } } = event;
        setSelectedStaffIds(typeof value === 'string' ? value.split(',') : value);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableEscapeKeyDown>
            <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 2 }}>
                <Typography variant="h6" fontWeight="bold">
                    {initialData ? '単発シフトの編集・詳細' : '新規シフトの追加'}
                </Typography>

                {/* 誤消去を防ぐため、完全削除（Delete）はヘッダー右端に小さく配置 */}
                {initialData && (
                    <Tooltip title="この予定を完全に削除（消去）">
                        <IconButton color="error" onClick={handleDelete} disabled={loading} size="small">
                            <DeleteIcon />
                        </IconButton>
                    </Tooltip>
                )}
            </DialogTitle>

            <DialogContent dividers sx={{ py: 3 }}>
                <Stack spacing={3}>
                    {initialData?.status === 'cancelled' && (
                        <Box p={2} bgcolor={tokens.status.error.bgAlt} borderRadius={2} border={`1px solid ${tokens.status.error.border}`} display="flex" flexDirection="column" gap={0.5}>
                            <Typography color="error" fontWeight="bold" variant="subtitle2">
                                ⚠ この予定はキャンセル（お休み）に設定されています
                            </Typography>
                            {initialData.cancel_reason && (
                                <Typography variant="caption" color="text.secondary">
                                    キャンセル理由: {initialData.cancel_reason}
                                </Typography>
                            )}
                        </Box>
                    )}

                    <FormControl fullWidth size="small" required>
                        <InputLabel>利用者</InputLabel>
                        <Select
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value as string)}
                            label="利用者"
                        >
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
                                    <Typography variant="body2" sx={{ fontWeight: selectedStaffIds.includes(s.id) ? 'bold' : 'normal' }}>
                                        {s.name}
                                    </Typography>
                                </MenuItem>
                            ))}
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

                    {initialData && (
                        <>
                            <Divider sx={{ my: 1 }} />
                            <Box p={2.5} border="1px solid #eee" borderRadius={2} bgcolor={tokens.neutral.gray50}>
                                <Typography variant="subtitle2" fontWeight="bold" color="text.primary" gutterBottom>
                                    お休み（キャンセル）の管理
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                                    利用者の急な入院や都合によるキャンセル時は、完全に削除するのではなく「お休み」に設定することを推奨します。実績管理に履歴を残すことができます。
                                </Typography>
                                {initialData.status === 'cancelled' ? (
                                    <Button
                                        variant="contained"
                                        color="success"
                                        onClick={() => handleToggleCancel(false)}
                                        disabled={loading}
                                        fullWidth
                                        sx={{ boxShadow: 'none' }}
                                    >
                                        キャンセルを取り消して「稼働中」に戻す
                                    </Button>
                                ) : (
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                        <TextField
                                            size="small"
                                            fullWidth
                                            placeholder="例：当日体調不良、入院などの理由を入力"
                                            value={cancelReason}
                                            onChange={(e) => setCancelReason(e.target.value)}
                                        />
                                        <Button
                                            variant="outlined"
                                            color="error"
                                            onClick={() => handleToggleCancel(true)}
                                            disabled={loading}
                                            sx={{ minWidth: 120, flexShrink: 0 }}
                                        >
                                            お休みにする
                                        </Button>
                                    </Stack>
                                )}
                            </Box>
                        </>
                    )}
                </Stack>
            </DialogContent>

            <DialogActions sx={{ p: 2, px: 3 }}>
                <Button onClick={onClose} color="inherit" disabled={loading}>
                    閉じる
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={loading}
                    sx={{ boxShadow: 'none', px: 3 }}
                >
                    {loading ? <CircularProgress size={24} color="inherit" /> : '変更を保存'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};