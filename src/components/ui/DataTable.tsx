import {
  CircularProgress,
  Box,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  type TableContainerProps,
  type TableRowProps,
} from '@mui/material';
import { useTheme, type Breakpoint } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { ReactNode } from 'react';
import { EmptyState } from './Layout';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T> extends Omit<TableContainerProps, 'children'> {
  rows: readonly T[];
  columns: readonly DataTableColumn<T>[];
  getRowKey: (row: T) => string | number;
  emptyTitle?: string;
  getRowSx?: (row: T) => TableRowProps['sx'];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  emptyDescription?: ReactNode;
  minWidth?: number;
  mobileCardRender?: (row: T) => ReactNode;
  mobileBreakpoint?: Breakpoint;
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  emptyTitle,
  emptyDescription,
  getRowSx,
  loading = false,
  onRowClick,
  minWidth = 640,
  mobileCardRender,
  mobileBreakpoint = 'sm',
  sx,
  ...props
}: DataTableProps<T>) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(mobileBreakpoint));

  if (mobileCardRender && isMobile) {
    return (
      <Box
        role="list"
        aria-label="データ一覧"
        sx={[
          { borderTop: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {loading && <Box role="status" aria-label="読み込み中" sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress size={28} /></Box>}
        {!loading && rows.length > 0 && (
          <Stack divider={<Divider />}>
            {rows.map((row) => (
              <Box key={getRowKey(row)} role="listitem" onClick={() => onRowClick?.(row)} sx={{ cursor: onRowClick ? 'pointer' : undefined, py: 1.5 }}>
                {mobileCardRender(row)}
              </Box>
            ))}
          </Stack>
        )}
        {!loading && rows.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
      </Box>
    );
  }

  return (
    <TableContainer
      tabIndex={0}
      aria-label="データ一覧"
      sx={[
        {
          overflowX: 'auto',
          borderTop: 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...props}
    >
      <Table sx={{ minWidth }}>
        <TableHead><TableRow>{columns.map((column) => <TableCell key={column.key} align={column.align}>{column.header}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {loading && <TableRow><TableCell colSpan={columns.length}><Box role="status" aria-label="読み込み中" sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress size={28} /></Box></TableCell></TableRow>}
          {!loading && rows.map((row) => <TableRow hover key={getRowKey(row)} onClick={() => onRowClick?.(row)} tabIndex={onRowClick ? 0 : undefined} sx={{ cursor: onRowClick ? 'pointer' : undefined, ...getRowSx?.(row) }}>{columns.map((column) => <TableCell key={column.key} align={column.align}>{column.render(row)}</TableCell>)}</TableRow>)}
          {!loading && rows.length === 0 && <TableRow><TableCell colSpan={columns.length}><EmptyState title={emptyTitle} description={emptyDescription} /></TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
