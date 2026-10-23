import { Box, Typography, Stack, CircularProgress } from '@/components/ui/mui';
import { AppButton, MonthField } from '@/components/ui';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteIcon from '@mui/icons-material/Delete';

type Props = {
    targetMonth: string; onMonthChange: (month: string) => void;
    canGenerate: boolean; canClear: boolean; generating: boolean; patternCount: number;
    onPreview: () => void; onClear: () => void;
};
export function ShiftMonthActions({ targetMonth, onMonthChange, canGenerate, canClear, generating, patternCount, onPreview, onClear }: Props) {
    return (
        <Box sx={{ p: 2, mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: 'background.tint', borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="body2" sx={{ fontWeight: '500' }}>登録したひな形をベースに、指定月のカレンダーへシフトを一括展開・同期します。</Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
                <MonthField label="対象月" size="small" value={targetMonth} onChange={e => onMonthChange(e.target.value)} />
                <AppButton variant="contained" intent="secondary" startIcon={generating ? <CircularProgress aria-label="月次処理中" size={16} color="inherit" /> : <PlayArrowIcon />} onClick={onPreview} disabled={!canGenerate || generating || patternCount === 0} sx={{ boxShadow: 'none' }}>
                    一括自動展開する
                </AppButton>
                <AppButton variant="outlined" intent="danger" startIcon={<DeleteIcon />} onClick={onClear} disabled={!canClear || generating || patternCount === 0}>
                    一括消去する
                </AppButton>
            </Stack>
        </Box>
    );
}
