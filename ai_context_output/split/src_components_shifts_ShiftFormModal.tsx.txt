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
import AddIcon from '@mui/icons-material/Add';
import ShiftSegmentEditor from './ShiftSegmentEditor';
import { ShiftPayload } from '@/app/actions/shift';
import type { SaveSegmentInput } from '@/app/actions/shiftSegments';
import { getServiceTypes, type ServiceType } from '@/app/actions/serviceTypes';
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
    shift_segments?: Array<{
        id: string;
        start_at: string;
        end_at: string;
        service_type?: { name: string } | null;
    }>;
};

type SegmentDraft = {
    service_type_id: string;
    start_at: string;
    end_at: string;
    staffs: { staff_id: string; staff_role_id: string }[];
};

type Props = {
    open: boolean;
    onClose: () => void;
    onSave: (payload: ShiftPayload, shiftId?: string) => Promise<void>;
    onToggleCancel?: (shiftId: string, isCancel: boolean, reason: string) => Promise<void>;
    onDelete?: (shiftId: string) => Promise<void>;
    onCreateRecord?: (shift: ShiftData, segmentId?: string) => void;
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
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [cancelReason, setCancelReason] = useState('');
    const [autoAssign, setAutoAssign] = useState(true);

    const [segments, setSegments] = useState<SegmentDraft[]>([]);
    const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);

    useEffect(() => {
        if (!open) return;

        // Load master data for the inline segment editor
        getServiceTypes(organizationId).then((types) => {
            setServiceTypes(types);
        });

        queueMicrotask(() => {
            const formatDatetime = (isoStr: string) => {
                if (!isoStr) return '';
                const d = new Date(isoStr);
                const pad = (n: number) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };
            if (initialData) {
                setClientId(initialData.client_id || '');
                setStartAt(formatDatetime(initialData.start_at));
                setEndAt(formatDatetime(initialData.end_at));
                setCancelReason(initialData.cancel_reason || '');
                setSegments([]); // EDIT mode: ShiftSegmentEditor handles loading from server
            } else {
                setClientId('');
                setSegments([]);
                setStartAt('');
                setEndAt('');
                setCancelReason('');
                setAutoAssign(true);
            }
        });
    }, [open, initialData, organizationId]);

    // Seed one blank segment when start/end time are set (CREATE mode only)
    useEffect(() => {
        if (initialData || segments.length > 0) return;
        if (!startAt || !endAt) return;
        queueMicrotask(() => setSegments([{
                service_type_id: '',
                start_at: startAt,
                end_at: endAt,
                staffs: [],
            }]));
    }, [startAt, endAt, initialData, segments.length]);

    const handleSave = async () => {
        if (!clientId || !startAt || !endAt) {
            showToast('必須項目（利用者、日時）をすべて入力してください', 'warning');
            return;
        }
        if (!initialData) {
            // CREATE: validate inline segments
            if (segments.length === 0) {
                showToast('サービス区間を1つ以上追加してください', 'warning');
                return;
            }
            if (segments.some(s => s.staffs.length === 0)) {
                showToast('すべてのサービス区間に担当スタッフを設定してください', 'warning');
                return;
            }
        }
        setLoading(true);
        try {
            const clientName = clients.find(c => c.id === clientId)?.name || '';
            const staffNames = segments.flatMap(s =>
                s.staffs.map(ss => staffs.find(st => st.id === ss.staff_id)?.name ?? '')
            ).filter(Boolean);
            const uniqueStaffNames = [...new Set(staffNames)];

            const payload: ShiftPayload = {
                organizationId,
                clientId,
                title: clientName + (uniqueStaffNames.length > 0 ? ` (${uniqueStaffNames.join(', ')})` : ''),
                startAt: new Date(startAt).toISOString(),
                endAt: new Date(endAt).toISOString(),
                segments: !initialData
                    ? segments.map((s, i): SaveSegmentInput => ({
                        service_type_id: s.service_type_id || null,
                        start_at: new Date(s.start_at).toISOString(),
                        end_at: new Date(s.end_at).toISOString(),
                        sort_order: i,
                        staffs: s.staffs.map(ss => ({ staff_id: ss.staff_id, staff_role_id: ss.staff_role_id || null })),
                    }))
                    : undefined,
                isModified: true,
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
                {initialData && onCreateRecord && (initialData.shift_segments?.length ?? 0) <= 1 && (
                    <AppButton
                        variant="outlined"
                        intent="secondary"
                        startIcon={<EditNoteIcon />}
                        onClick={() => onCreateRecord(initialData, initialData.shift_segments?.[0]?.id)}
                        disabled={loading || initialData.status === 'cancelled'}
                    >
                        記録作成
                    </AppButton>
                )}
                {initialData && onCreateRecord && (initialData.shift_segments?.length ?? 0) > 1 && (
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        {initialData.shift_segments?.map((segment, index) => {
                            const start = new Date(segment.start_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                            const end = new Date(segment.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
                            return (
                                <AppButton
                                    key={segment.id}
                                    variant="outlined"
                                    intent="secondary"
                                    startIcon={<EditNoteIcon />}
                                    onClick={() => onCreateRecord(initialData, segment.id)}
                                    disabled={loading || initialData.status === 'cancelled'}
                                >
                                    {`${segment.service_type?.name ?? `区間${index + 1}`} ${start}-${end}`}
                                </AppButton>
                            );
                        })}
                    </Stack>
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

                    {/* CREATE モードのみ: インラインセグメント編集 */}
                    {!initialData && (
                        <>
                            <Box border="1px solid" borderColor="divider" borderRadius={2} p={2}>
                                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                                    サービス区間・担当スタッフ（必須）
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                                    時間帯ごとにサービス種別と担当スタッフを設定してください。
                                </Typography>
                                {segments.map((seg, idx) => (
                                    <Box key={idx} mb={2} p={1.5} border="1px solid" borderColor="divider" borderRadius={1}>
                                        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                                            <Typography variant="caption">区間 {idx + 1}</Typography>
                                            <IconButton size="small" color="error"
                                                onClick={() => setSegments(prev => prev.filter((_, i) => i !== idx))}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Stack>
                                        {/* 開始/終了 */}
                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} mb={1}>
                                            <DateTimeField label="開始" size="small" fullWidth value={seg.start_at}
                                                onChange={e => setSegments(prev => prev.map((s, i) => i === idx ? { ...s, start_at: e.target.value } : s))} />
                                            <DateTimeField label="終了" size="small" fullWidth value={seg.end_at}
                                                onChange={e => setSegments(prev => prev.map((s, i) => i === idx ? { ...s, end_at: e.target.value } : s))} />
                                        </Stack>
                                        {/* サービス種別 */}
                                        <SelectField
                                            label="サービス種別"
                                            size="small"
                                            value={seg.service_type_id}
                                            options={[{ value: '', label: '（なし）' }, ...serviceTypes.map(t => ({ value: t.id, label: t.name }))]}
                                            onChange={val => setSegments(prev => prev.map((s, i) => i === idx ? { ...s, service_type_id: val } : s))}
                                        />
                                        {/* 担当スタッフ（必須） */}
                                        <MultiSelectField
                                            required
                                            label="担当スタッフ（必須）"
                                            options={staffs}
                                            value={staffs.filter(st => seg.staffs.some(ss => ss.staff_id === st.id))}
                                            onChange={selected => setSegments(prev => prev.map((s, i) =>
                                                i === idx ? { ...s, staffs: selected.map(st => ({ staff_id: st.id, staff_role_id: '' })) } : s
                                            ))}
                                            getOptionLabel={st => st.name}
                                            getOptionValue={st => st.id}
                                        />
                                    </Box>
                                ))}
                                <Button size="small" startIcon={<AddIcon />}
                                    onClick={() => setSegments(prev => [...prev, { service_type_id: '', start_at: startAt, end_at: endAt, staffs: [] }])}>
                                    区間を追加
                                </Button>
                            </Box>

                            {/* 新規作成時のみ: 自動アサインチェックボックス */}
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
                                        担当スタッフを基本担当（担当スタッフ設定）にも登録する
                                    </Typography>
                                }
                            />
                        </>
                    )}

                    {initialData && (
                        <>
                            <Divider sx={{ my: 1 }} />
                            <Box p={2.5} border="1px solid" borderColor="divider" borderRadius={2} bgcolor="background.subtle">
                                <Typography variant="subtitle2" fontWeight="bold" color="text.primary" gutterBottom>
                                    サービス区間（必須）
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                                    時間帯ごとにサービス種別・担当スタッフを設定してください。設定した区間ごとにサービス提供記録が作成されます。
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
