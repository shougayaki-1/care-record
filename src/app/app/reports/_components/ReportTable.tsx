'use client';

import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Checkbox, TableSortLabel, Chip, Tooltip, Box, Typography, Button, Paper } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { Report, getHelperNames } from '@/utils/reportExportHelper';

type Props = {
  reports: Report[];
  selected: readonly string[];
  setSelected: (val: readonly string[]) => void;
  order: 'asc' | 'desc';
  setOrder: (val: 'asc' | 'desc') => void;
  orderBy: string;
  setOrderBy: (val: string) => void;
  onOpenDetail: (report: Report) => void;
};

export function ReportTable({
  reports, selected, setSelected, order, setOrder, orderBy, setOrderBy, onOpenDetail
}: Props) {
  const handleSelectAllClick = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelected(reports.map(n => n.id));
      return;
    }
    setSelected([]);
  };

  const handleClick = (id: string) => {
    const selectedIndex = selected.indexOf(id);
    let newSelected: readonly string[] = [];
    if (selectedIndex === -1) newSelected = newSelected.concat(selected, id);
    else if (selectedIndex === 0) newSelected = newSelected.concat(selected.slice(1));
    else if (selectedIndex === selected.length - 1) newSelected = newSelected.concat(selected.slice(0, -1));
    else if (selectedIndex > 0) newSelected = newSelected.concat(selected.slice(0, selectedIndex), selected.slice(selectedIndex + 1));
    setSelected(newSelected);
  };

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const formatDateTime = (d: Date) => {
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <TableContainer component={Paper} sx={{ boxShadow: 'none', border: '1px solid #E3E5E8' }}>
      <Table>
        <TableHead sx={{ bgcolor: '#F2F3F5' }}>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox checked={reports.length > 0 && selected.length === reports.length} onChange={handleSelectAllClick} />
            </TableCell>
            <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>ステータス</TableCell>
            <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>
              <TableSortLabel active={orderBy === 'start_at'} direction={order} onClick={() => handleRequestSort('start_at')}>
                開始 〜 終了日時
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>
              <TableSortLabel active={orderBy === 'client_name'} direction={order} onClick={() => handleRequestSort('client_name')}>
                利用者
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>担当</TableCell>
            <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {reports.map((row) => {
            const start = new Date(row.start_at);
            const end = new Date(row.end_at);
            const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
            const isAbnormal = durationHours > 24 || durationHours < 0;

            return (
              <TableRow key={row.id} selected={selected.includes(row.id)} hover sx={{ '&:last-child td, &:last-child th': { border: 0 }, bgcolor: isAbnormal ? '#fff5f5' : 'inherit' }}>
                <TableCell padding="checkbox">
                  <Checkbox checked={selected.includes(row.id)} onClick={() => handleClick(row.id)} />
                </TableCell>
                <TableCell>
                  <Chip label={row.status === 'approved' ? '承認済' : row.status === 'remanded' ? '差戻し' : '未承認'} color={row.status === 'approved' ? 'success' : row.status === 'remanded' ? 'error' : 'warning'} size="small" variant="outlined" />
                </TableCell>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Box>
                      <Typography variant="body2" color={isAbnormal ? 'error' : 'inherit'} fontWeight={isAbnormal ? 'bold' : 'normal'}>
                        {formatDateTime(start)} 〜
                      </Typography>
                      <Typography variant="body2" color={isAbnormal ? 'error' : 'text.secondary'} fontWeight={isAbnormal ? 'bold' : 'normal'}>
                        {formatDateTime(end)}
                      </Typography>
                    </Box>
                    {isAbnormal && (
                      <Tooltip title="期間が24時間を超えているか、終了時刻が開始より前です（入力ミスの可能性があります）">
                        <ErrorOutlineIcon color="error" fontSize="small" />
                      </Tooltip>
                    )}
                  </Box>
                </TableCell>
                <TableCell>{row.clients.name}</TableCell>
                <TableCell>{getHelperNames(row)}</TableCell>
                <TableCell>
                  <Button size="small" variant={isAbnormal ? "contained" : "outlined"} color={isAbnormal ? "error" : "primary"} onClick={() => onOpenDetail(row)} sx={{ fontSize: '0.75rem', py: 0.5 }}>
                    {isAbnormal ? "確認・修正" : "詳細"}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
          {reports.length === 0 && (
            <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: '#999' }}>該当する記録がありません</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}