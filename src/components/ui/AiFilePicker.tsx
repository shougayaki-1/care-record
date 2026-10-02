'use client';

import { useState, type ChangeEventHandler, type DragEventHandler, type RefObject } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { AppButton } from './AppButton';

export function AiFilePicker({ inputRef, onChange, onDrop, multiple = false, disabled = false, buttonLabel = 'ファイルを選択' }: {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  multiple?: boolean;
  disabled?: boolean;
  buttonLabel?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  return <Box
    onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragOver(true); }}
    onDragLeave={() => setDragOver(false)}
    onDrop={(event) => { event.preventDefault(); setDragOver(false); if (!disabled) onDrop(event); }}
    sx={{ p: { xs: 2, sm: 3 }, border: '2px dashed', borderColor: dragOver ? 'primary.main' : 'divider', bgcolor: dragOver ? 'background.tint' : 'background.paper', minWidth: 0 }}
  >
    <input ref={inputRef} type="file" multiple={multiple} accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={onChange} disabled={disabled} aria-label="記録ファイル" />
    <Stack spacing={1.5} alignItems="center" textAlign="center">
      <Typography variant="body2" color="text.secondary">PDF・JPEG・PNG・WebPをドラッグ＆ドロップ、またはファイルを選択してください。</Typography>
      <AppButton intent="secondary" variant="outlined" startIcon={<CloudUploadIcon />} disabled={disabled} onClick={() => inputRef.current?.click()}>{buttonLabel}</AppButton>
      <Typography variant="caption" color="text.secondary">1ファイル最大10MB</Typography>
    </Stack>
  </Box>;
}
