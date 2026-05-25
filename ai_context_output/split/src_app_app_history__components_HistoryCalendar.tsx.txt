'use client';

import { Box, Typography, Grid, Tooltip } from '@mui/material';
import { Report } from '@/app/app/history/types';

type Props = {
    year: number;
    month: number;
    events: Report[];
    onSelect: (report: Report) => void;
};

export function HistoryCalendar({ year, month, events, onSelect }: Props) {
    const firstDay = new Date(year, month, 1).getDay(); // 0: Sun, 1: Mon...
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // カレンダーのマス目作成
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    return (
        <Grid container spacing={1}>
            {['日','月','火','水','木','金','土'].map(d => (
                // ★修正: MUI v6 仕様に合わせ、item を削除し、size プロパティを使用します
                <Grid size={{ xs: 12/7 }} key={d} sx={{ textAlign: 'center', fontWeight: 'bold', fontSize: 12, color: 'text.secondary', py: 1 }}>{d}</Grid>
            ))}
            {days.map((d, i) => {
                const dayEvents = d ? events.filter(e => new Date(e.start_at).getDate() === d) : [];
                return (
                    // ★修正: MUI v6 仕様に合わせ、item を削除し、size プロパティを使用します
                    <Grid size={{ xs: 12/7 }} key={i}>
                        <Box 
                            sx={{ 
                                height: 80, border: '1px solid #eee', borderRadius: 1, p: 0.5, 
                                bgcolor: d ? 'white' : 'transparent',
                                display: 'flex', flexDirection: 'column'
                            }}
                        >
                            {d && (
                                <>
                                    <Typography variant="caption" fontWeight="bold" color={new Date().getDate() === d && year === new Date().getFullYear() && month === new Date().getMonth() ? 'primary' : 'textSecondary'}>
                                        {d}
                                    </Typography>
                                    <Box sx={{ flexGrow: 1, overflowY: 'auto', '::-webkit-scrollbar': {width:0} }}>
                                        {dayEvents.map(ev => (
                                            <Tooltip key={ev.id} title={`${new Date(ev.start_at).getHours()}:${String(new Date(ev.start_at).getMinutes()).padStart(2,'0')} ${ev.clients?.name}`}>
                                                <Box 
                                                    onClick={() => onSelect(ev)}
                                                    sx={{ 
                                                        bgcolor: ev.status === 'approved' ? '#e8f5e9' : (ev.status === 'remanded' ? '#ffebee' : '#fff3e0'), 
                                                        fontSize: 10, p: 0.2, borderRadius: 0.5, mb: 0.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                                                        cursor: 'pointer',
                                                        '&:hover': { filter: 'brightness(0.95)' }
                                                    }}
                                                >
                                                    {ev.clients?.name}
                                                </Box>
                                            </Tooltip>
                                        ))}
                                    </Box>
                                </>
                            )}
                        </Box>
                    </Grid>
                );
            })}
        </Grid>
    );
}