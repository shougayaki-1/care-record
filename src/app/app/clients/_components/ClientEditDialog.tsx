'use client';

import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';

interface ClientEditDialogProps {
  open: boolean;
  onClose: () => void;
  name: string;
  onChangeName: (val: string) => void;
  onConfirm: () => void;
  disabled: boolean;
}

export function ClientEditDialog({
  open,
  onClose,
  name,
  onChangeName,
  onConfirm,
  disabled
}: ClientEditDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>利用者名の変更</DialogTitle>
      <DialogContent sx={{ minWidth: 300 }}>
        <TextField
          autoFocus
          margin="dense"
          label="利用者氏名"
          fullWidth
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={disabled}>
          キャンセル
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          disabled={disabled || !name.trim()}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}