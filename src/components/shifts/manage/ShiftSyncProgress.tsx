import { Box, Typography, LinearProgress } from '@/components/ui/mui';
import type { SyncProgress } from '@/hooks/useCalendarSync';
export function ShiftSyncProgress({ syncProgress }: { syncProgress: SyncProgress | null }) {
    return syncProgress ? (
        <Box sx={{ position: 'fixed', bottom: 20, right: 20, bgcolor: 'background.paper', p: 2.5, borderRadius: 1, boxShadow: 3, zIndex: 9999, border: '1px solid', borderColor: 'divider', minWidth: 280 }}>
            <Typography variant="body2" fontWeight="bold" gutterBottom>Googleカレンダー同期中...</Typography>
            <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {syncProgress.currentName}
            </Typography>
            {syncProgress.total > 1 ? (
                <>
                    <LinearProgress aria-label="Googleカレンダー同期進捗" variant="determinate" value={syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0} sx={{ height: 6, borderRadius: 1 }} />
                    <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'right', fontWeight: 'bold' }}>
                        {syncProgress.current} / {syncProgress.total} 件完了
                    </Typography>
                </>
            ) : (
                <LinearProgress aria-label="Googleカレンダー同期進捗" sx={{ height: 6, borderRadius: 1 }} />
            )}
        </Box>
    ) : null;
}
