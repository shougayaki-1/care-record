'use client';

import {
  MenuItem,
  TextField,
  type MenuItemProps,
  type TextFieldProps,
} from '@mui/material';
import type { ChangeEvent, WheelEvent } from 'react';

export type AppTextFieldProps = TextFieldProps;

export function AppTextField(props: AppTextFieldProps) {
  return <TextField fullWidth {...props} />;
}

export type NumberFieldProps = Omit<TextFieldProps, 'type' | 'onChange'> & {
  value: string | number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  allowWheel?: boolean;
};

export function NumberField({ allowWheel = false, slotProps, ...props }: NumberFieldProps) {
  const handleWheel = (event: WheelEvent<HTMLInputElement>) => {
    if (!allowWheel) event.currentTarget.blur();
  };

  return (
    <TextField
      fullWidth
      type="number"
      {...props}
      slotProps={{
        ...slotProps,
        htmlInput: { inputMode: 'decimal', onWheel: handleWheel, ...slotProps?.htmlInput },
      }}
    />
  );
}

export type DateTimeFieldProps = Omit<TextFieldProps, 'type'> & {
  kind?: 'date' | 'time' | 'datetime-local' | 'month';
};

export function DateTimeField({ kind = 'datetime-local', slotProps, ...props }: DateTimeFieldProps) {
  return (
    <TextField
      fullWidth
      type={kind}
      {...props}
      slotProps={{ ...slotProps, inputLabel: { shrink: true, ...slotProps?.inputLabel } }}
    />
  );
}

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SelectFieldProps<T extends string | number> = Omit<TextFieldProps, 'select' | 'onChange'> & {
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  menuItemProps?: MenuItemProps;
};

export function SelectField<T extends string | number>({ options, onChange, menuItemProps, ...props }: SelectFieldProps<T>) {
  return (
    <TextField select fullWidth {...props} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <MenuItem {...menuItemProps} key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

