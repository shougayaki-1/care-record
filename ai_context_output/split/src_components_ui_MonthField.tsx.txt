'use client';

import { useRef } from 'react';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import { IconButton, InputAdornment, TextField, type TextFieldProps } from '@mui/material';

type MonthFieldProps = Omit<TextFieldProps, 'type'>;

export function MonthField({ slotProps, sx, ...props }: MonthFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.focus();
  };

  return (
    <TextField
      {...props}
      type="month"
      inputRef={inputRef}
      onClick={(event) => {
        props.onClick?.(event);
        openPicker();
      }}
      sx={{ bgcolor: 'background.paper', ...sx }}
      slotProps={{
        ...slotProps,
        inputLabel: { shrink: true, ...slotProps?.inputLabel },
        input: {
          ...slotProps?.input,
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                edge="end"
                size="small"
                aria-label="対象月をカレンダーから選択"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openPicker();
                }}
              >
                <CalendarMonthIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
