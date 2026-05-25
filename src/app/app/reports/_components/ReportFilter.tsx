'use client';

import { Box, Stack, TextField, MenuItem, FormControlLabel, Switch, Button, Paper, Typography } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import { ClientData } from '@/types';

type Props = {
  filterClientId: string;
  setFilterClientId: (val: string) => void;
  filterStatus: string;
  setFilterStatus: (val: string) => void;
  startDate: string;
  setStartDate: (val: string) => void;
  endDate: string;
  setEndDate: (val: string) => void;
  onlyPending: boolean;
  setOnlyPending: (val: boolean) => void;
  clients: ClientData[];
  onSearch: () => void;
};

export function ReportFilter({
  filterClientId, setFilterClientId,
  filterStatus, setFilterStatus,
  startDate, setStartDate,
  endDate, setEndDate,
  onlyPending, setOnlyPending,
  clients, onSearch
}: Props) {
  return (
    <Paper sx={{ p: 2, mb: 3, bgcolor: '#F2F3F5', boxShadow: 'none' }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box display="flex" alignItems="center" gap={1} color="#5C5E66">
            <FilterListIcon fontSize="small" />
            <Typography variant="subtitle2" fontWeight="bold">絞り込み:</Typography>
          </Box>
          
          <TextField select label="利用者" size="small" value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} sx={{ minWidth: 150, bgcolor: 'white' }}>
            <MenuItem value="all">全員</MenuItem>
            {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>

          <TextField select label="ステータス" size="small" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} sx={{ minWidth: 120, bgcolor: 'white' }}>
            <MenuItem value="all">全て</MenuItem>
            <MenuItem value="pending">未承認</MenuItem>
            <MenuItem value="approved">承認済</MenuItem>
          </TextField>

          <Box display="flex" alignItems="center" gap={1}>
            <TextField type="date" label="開始日" size="small" InputLabelProps={{ shrink: true }} value={startDate} onChange={(e) => setStartDate(e.target.value)} sx={{ bgcolor: 'white' }} />
            <Typography>～</Typography>
            <TextField type="date" label="終了日" size="small" InputLabelProps={{ shrink: true }} value={endDate} onChange={(e) => setEndDate(e.target.value)} sx={{ bgcolor: 'white' }} />
          </Box>

          <FormControlLabel control={<Switch checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} color="warning" />} label="未承認・差戻しのみ" />
          <Button variant="contained" startIcon={<SearchIcon />} onClick={onSearch} sx={{ px: 3, boxShadow: 'none' }}>検索</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}