import { Typography, Chip, Tooltip, IconButton, Table, TableHead, TableBody, TableRow, TableCell, TableContainer } from '@/components/ui/mui';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import type { ShiftPatternData } from '@/features/shifts/types';

const formatRule = (rrule: string) => {
    let desc = '';
    if (rrule.includes('FREQ=WEEKLY')) desc += '毎週 ';
    else if (rrule.includes('FREQ=MONTHLY')) desc += '毎月 ';

    const intervalMatch = rrule.match(/INTERVAL=([0-9]+)/);
    if (intervalMatch && intervalMatch[1] !== '1') {
        const unit = rrule.includes('FREQ=MONTHLY') ? 'ヶ月' : '週間';
        desc = `${intervalMatch[1]}${unit}に1回 `;
    }

    const daysMap: Record<string, string> = { 'MO': '月', 'TU': '火', 'WE': '水', 'TH': '木', 'FR': '金', 'SA': '土', 'SU': '日' };
    const match = rrule.match(/BYDAY=([^;]+)/);
    if (match) {
        const days = match[1].split(',').map(d => {
            const num = d.replace(/[A-Z]/g, '');
            const day = d.replace(/[0-9]/g, '');
            return (num ? `第${num}` : '') + (daysMap[day] || '');
        });
        desc += days.join(', ');
    }
    return desc;
};


type Props = {
    patterns: ShiftPatternData[];
    mastersReady: boolean;
    canEditShift: boolean;
    canDeleteShift: boolean;
    onEdit: (pattern: ShiftPatternData) => void;
    onDelete: (id: string) => void;
};
export function ShiftPatternTable({ patterns, mastersReady, canEditShift, canDeleteShift, onEdit, onDelete }: Props) {
    return <>
        <Typography variant="subtitle1" fontWeight="bold" mb={2}>登録済みのひな形パターン一覧</Typography>
        <TableContainer sx={{ borderRadius: 1, mb: 4 }}>
            <Table>
                <TableHead sx={{ bgcolor: 'background.subtle' }}>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>対象の利用者</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>デフォルト担当者</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>予定時間帯</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>繰り返しサイクル</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {patterns.length === 0 ? (
                        <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>ひな形が登録されていません</TableCell></TableRow>
                    ) : (
                        patterns.map((p) => (
                            <TableRow key={p.id} hover>
                                <TableCell sx={{ fontWeight: 'bold' }}>{p.clients?.name}</TableCell>
                                <TableCell>{p.shift_pattern_staffs.map(s => s.staffs?.name).join(', ') || '未割り当て'}</TableCell>
                                <TableCell>{p.start_time.slice(0, 5)} 〜 {p.end_time.slice(0, 5)}</TableCell>
                                <TableCell><Chip label={formatRule(p.rrule)} size="small" color="primary" variant="outlined" /></TableCell>
                                <TableCell align="center">
                                    {canEditShift && <Tooltip title="ひな形を編集"><IconButton disabled={!mastersReady} size="small" color="primary" onClick={() => onEdit(p)} sx={{ mr: 1 }}><EditIcon fontSize="small" /></IconButton></Tooltip>}
                                    {canDeleteShift && <Tooltip title="ひな形を削除"><IconButton size="small" color="error" onClick={() => onDelete(p.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    </>;
}
