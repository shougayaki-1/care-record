'use client';

import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';

interface ClientAddDialogProps {
  open: boolean;
  onClose: () => void;
  name: string;
  onChangeName: (val: string) => void;
  onConfirm: () => void;
  disabled: boolean;
}

export function ClientAddDialog({
  open,
  onClose,
  name,
  onChangeName,
  onConfirm,
  disabled
}: ClientAddDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>利用者の追加</DialogTitle>
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
          登録
        </Button>
      </DialogActions>
    </Dialog>
  );
}