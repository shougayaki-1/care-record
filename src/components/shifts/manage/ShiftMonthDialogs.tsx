import { Box, Typography, Stack, Chip, FormControlLabel, RadioGroup, Radio } from '@/components/ui/mui';
import { AppDialog, AppButton } from '@/components/ui';
import type { ShiftMonthPreview, ShiftClearMode } from '@/hooks/shifts/useShiftMonthOperations';

type DialogProps = { open: boolean; targetMonth: string; onClose: () => void; onConfirm: () => void };
export function ShiftMonthClearDialog({ open, targetMonth, onClose, onConfirm, clearMode, onModeChange }: DialogProps & {
    clearMode: ShiftClearMode; onModeChange: (mode: ShiftClearMode) => void;
}) {
    return (
        <AppDialog open={open} onClose={onClose} maxWidth="xs" title={`${targetMonth}月の展開シフトを消去`} dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={onClose}>キャンセル</AppButton><AppButton onClick={onConfirm} intent="danger">消去を実行</AppButton></>}>
            <Typography sx={{ mb: 2 }}>消去方法を選択してください。</Typography>
            <RadioGroup value={clearMode} onChange={(e) => onModeChange(e.target.value as ShiftClearMode)}>
                <FormControlLabel
                    value="unmodified"
                    control={<Radio />}
                    label={
                        <Box sx={{ py: 1 }}>
                            <Typography variant="body2" fontWeight="bold">未変更のシフトだけ消す（推奨）</Typography>
                            <Typography variant="caption" color="text.secondary" display="block">
                                手動で時間調整や担当ヘルパーを変更した箇所のシフトは安全に残し、自動展開したまま手を付けていない予定だけを消去します。
                            </Typography>
                        </Box>
                    }
                />
                <FormControlLabel
                    value="all"
                    control={<Radio />}
                    label={
                        <Box sx={{ py: 1 }}>
                            <Typography variant="body2" fontWeight="bold" color="error">全部一括消去する</Typography>
                            <Typography variant="caption" color="text.secondary" display="block">
                                個別調整・メモ・キャンセル済みの予定も含めて、ひな形から展開された予定をすべてクリアします。
                            </Typography>
                        </Box>
                    }
                />
            </RadioGroup>
        </AppDialog>
    );
}
export function ShiftMonthPreviewDialog({ open, targetMonth, onClose, onConfirm, previewDetails, mastersReady }: DialogProps & {
    previewDetails: ShiftMonthPreview | null; mastersReady: boolean;
}) {
    return (
        <AppDialog open={open} onClose={onClose} maxWidth="sm" title={`${targetMonth}月 シフト展開の確認`} actions={<><AppButton variant="text" intent="secondary" onClick={onClose}>閉じる</AppButton><AppButton disabled={!mastersReady} onClick={onConfirm} intent="secondary" autoFocus>確定してカレンダーに展開</AppButton></>}>
            {previewDetails && (
                <Stack spacing={2}>
                    <Typography variant="body2" paragraph>
                        以下の内容でカレンダーにシフト実体を作成します。既存の未編集シフトは自動で上書き更新され、現場で編集済みの調整シフトは安全にスキップ（自動保護）されます。
                    </Typography>
                    <Box p={2} bgcolor="background.tint" borderRadius={2} border="1px solid" borderColor="divider" mb={1.5}>
                        <Typography variant="subtitle2" component="p" fontWeight="bold" color="text.primary">展開予定の総シフト数： {previewDetails.total} 件</Typography>
                    </Box>
                    <Typography variant="subtitle2" component="p" fontWeight="bold">ひな形ごとの生成予定内訳:</Typography>
                    <Stack spacing={1} sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid', borderColor: 'divider', p: 1, borderRadius: 1, bgcolor: 'background.subtle' }}>
                        {previewDetails.details.map((d, index) => (
                            <Box key={index} display="flex" justifyContent="space-between" alignItems="center">
                                <Typography variant="caption" fontWeight="bold">{d.title}</Typography>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    {d.isOvernight && <Chip label="日またぎ夜勤" size="small" color="secondary" variant="outlined" sx={{ height: 16, fontSize: '0.65rem' }} />}
                                    <Typography variant="caption" color="text.secondary">{d.count} 件</Typography>
                                </Stack>
                            </Box>
                        ))}
                    </Stack>
                </Stack>
            )}
        </AppDialog>
    );
}
