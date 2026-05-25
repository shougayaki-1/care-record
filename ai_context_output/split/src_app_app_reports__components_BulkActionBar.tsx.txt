'use client';

import React from 'react';
import { Paper, Typography, Stack, Button, Divider, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ArticleIcon from '@mui/icons-material/Article';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RestoreIcon from '@mui/icons-material/Restore';
import DeleteIcon from '@mui/icons-material/Delete';

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  processing: boolean;
  hasGasProgress: boolean;
  onExportCSV: () => void;
  onBulkDownloadPDF: () => void;
  onCreateGasPdf: () => void;
  onBulkApprove: () => void;
  onBulkRemand: () => void;
  onBulkDelete: () => void;
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  processing,
  hasGasProgress,
  onExportCSV,
  onBulkDownloadPDF,
  onCreateGasPdf,
  onBulkApprove,
  onBulkRemand,
  onBulkDelete
}: BulkActionBarProps) {
  const isSelectedActive = selectedCount > 0;

  return (
    <Paper
      sx={{
        p: 2,
        mb: 2,
        bgcolor: isSelectedActive ? alpha('#2255CC', 0.1) : '#fff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        border: '1px solid #E3E5E8',
        boxShadow: 'none',
      }}
    >
      <Box>
        <Typography variant="body1" fontWeight="bold">
          {isSelectedActive ? `${selectedCount} 件選択中` : `検索結果: ${totalCount} 件`}
        </Typography>
      </Box>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={onExportCSV} disabled={processing}>
          CSV
        </Button>
        <Button variant="outlined" size="small" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={onBulkDownloadPDF} disabled={processing}>
          PDF
        </Button>
        {isSelectedActive ? (
          <>
            <Divider orientation="vertical" flexItem />
            <Button
              variant="contained"
              size="small"
              color="success"
              startIcon={<ArticleIcon />}
              onClick={onCreateGasPdf}
              disabled={hasGasProgress || processing}
            >
              {hasGasProgress ? '作成中...' : '帳票作成(GAS)'}
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<CheckCircleIcon />}
              onClick={onBulkApprove}
              disabled={processing}
              sx={{ boxShadow: 'none' }}
            >
              一括承認
            </Button>
            <Button
              variant="contained"
              size="small"
              color="warning"
              startIcon={<RestoreIcon />}
              onClick={onBulkRemand}
              disabled={processing}
            >
              一括差戻し
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={onBulkDelete}
              disabled={processing}
            >
              削除
            </Button>
          </>
        ) : (
          <Button
            variant="outlined"
            size="small"
            color="success"
            startIcon={<ArticleIcon />}
            onClick={onCreateGasPdf}
            disabled={hasGasProgress || processing}
          >
            {hasGasProgress ? '作成中...' : '全件帳票作成'}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}