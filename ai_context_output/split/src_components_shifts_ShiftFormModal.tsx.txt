'use client';

import React, { useState, useEffect } from 'react';
import {
    Button, Stack,
    Box, Typography,
    IconButton, Tooltip, Divider,
    FormControlLabel, Checkbox
} from '@/components/ui/mui';
import DeleteIcon from '@mui/icons-material/Delete';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ShiftSegmentEditor from './ShiftSegmentEditor';
import { ShiftPayload } from '@/app/actions/shift';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { AppButton, AppDialog, AppTextField, DateTimeField, MultiSelectField, SelectField } from '@/components/ui';

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
    onCreateRecord?: (shift: ShiftData) => void;
    clients: ClientData[];
    staffs: StaffData[];
    organizationId: string;
    initialData?: ShiftData | null;
    canSave?: boolean;
};

export const ShiftFormModal = ({
    open, onClose, onSave, onToggleCancel, onDelete, onCreateRecord, clients, staffs, organizationId, initialData, canSave = true
}: Props) => {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [loading, setLoading] = useState(false);

    const [clientId, setClientId] = useState('');
    const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [cancelReason, setCancelReason] = useState('');
    const [autoAssign, setAutoAssign] = useState(true);

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
                setAutoAssign(true);
            }
        }
    }, [open, initialData]);

    const handleSave = async () => {
        if (!clientId || !startAt || !endAt || selectedStaffIds.length === 0) {
            showToast('必須項目（利用者、スタッフ、日時）をすべて入力してください', 'warning');
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
                isModified: true, // 手動で保存したため「個別調整済み」フラグを立てる
                autoAssign: !initialData ? autoAssign : false,
            };

            await onSave(payload, initialData?.id);
            onClose();
        } catch (error) {
            console.error(error);
            showToast('保存に失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleCancel = async (isCancel: boolean) => {
        if (!initialData || !onToggleCancel) return;

        const confirmMsg = isCancel
            ? 'この予定を「お休み（キャンセル）」扱いに変更しますか？'
            : 'キャンセルを取り消して、通常の稼働予定に復元しますか？';

        if (!(await confirm({ message: confirmMsg }))) return;

        setLoading(true);
        try {
            await onToggleCancel(initialData.id, isCancel, cancelReason);
            onClose();
        } catch (error) {
            console.error(error);
            showToast('処理に失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!initialData || !onDelete) return;
        if (!(await confirm({
            title: 'シフトの削除',
            message: 'このシフトをカレンダーから完全に削除しますか？\n※この操作は取り消せません。Googleカレンダーからも完全に消去されます。',
            confirmText: '削除する', confirmColor: 'error',
        }))) return;

        setLoading(true);
        try {
            await onDelete(initialData.id);
            onClose();
        } catch (error) {
            console.error(error);
            showToast('削除に失敗しました', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AppDialog
            open={open}
            onClose={onClose}
            disableEscapeKeyDown
            loading={loading}
            title={initialData ? '単発シフトの編集・詳細' : '新規シフトの追加'}
            titleAction={initialData && (
                    <Tooltip title="この予定を完全に削除（消去）">
                        <IconButton color="error" onClick={handleDelete} disabled={loading} size="small">
                            <DeleteIcon />
                        </IconButton>
                    </Tooltip>
                )}
            contentSx={{ py: 3 }}
            actions={<>
                {initialData && onCreateRecord && (
                    <AppButton
                        variant="outlined"
                        intent="secondary"
                        startIcon={<EditNoteIcon />}
                        onClick={() => onCreateRecord(initialData)}
                        disabled={loading || initialData.status === 'cancelled'}
                    >
                        記録作成
                    </AppButton>
                )}
                <Box sx={{ flexGrow: 1 }} />
                <AppButton variant="text" intent="secondary" onClick={onClose} disabled={loading}>閉じる</AppButton>
                {canSave && <AppButton onClick={handleSave} loading={loading}>変更を保存</AppButton>}
            </>}
            actionsSx={{ flexWrap: 'wrap', gap: 1 }}
        >
                <Stack spacing={3}>
                    {initialData?.status === 'cancelled' && (
                        <Box p={2} bgcolor="error.light" borderRadius={2} border="1px solid" borderColor="error.light" display="flex" flexDirection="column" gap={0.5}>
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

                    <SelectField
                        required
                        label="利用者"
                        value={clientId}
                        options={clients.map((client) => ({ value: client.id, label: client.name }))}
                        onChange={setClientId}
                    />

                    <MultiSelectField
                        required
                        label="担当スタッフ（複数選択可）"
                        options={staffs}
                        value={staffs.filter((staff) => selectedStaffIds.includes(staff.id))}
                        onChange={(selected) => setSelectedStaffIds(selected.map((staff) => staff.id))}
                        getOptionLabel={(staff) => staff.name}
                        getOptionValue={(staff) => staff.id}
                    />

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <DateTimeField
                            label="開始日時"
                            fullWidth
                            size="small"
                            required
                            value={startAt}
                            onChange={(e) => setStartAt(e.target.value)}
                        />
                        <DateTimeField
                            label="終了日時"
                            fullWidth
                            size="small"
                            required
                            value={endAt}
                            onChange={(e) => setEndAt(e.target.value)}
                        />
                    </Stack>

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
                                    選択したスタッフを基本担当（担当スタッフ設定）にも登録する
                                </Typography>
                            }
                        />
                    )}

                    {initialData && (
                        <>
                            <Divider sx={{ my: 1 }} />
                            <Box p={2.5} border="1px solid" borderColor="divider" borderRadius={2} bgcolor="background.subtle">
                                <Typography variant="subtitle2" fontWeight="bold" color="text.primary" gutterBottom>
                                    サービス区間（任意）
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                                    時間帯ごとにサービス種別・スタッフ役割を設定できます。設定した区間ごとにサービス提供記録が作成されます。
                                </Typography>
                                <ShiftSegmentEditor
                                    orgId={organizationId}
                                    shiftId={initialData.id}
                                    shiftStartAt={initialData.start_at}
                                    shiftEndAt={initialData.end_at}
                                    allStaffs={staffs}
                                />
                            </Box>

                            <Divider sx={{ my: 1 }} />
                            <Box p={2.5} border="1px solid" borderColor="divider" borderRadius={2} bgcolor="background.subtle">
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
                                        <AppTextField
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
        </AppDialog>
    );
};
