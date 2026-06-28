'use client';

import { Button, CircularProgress, type ButtonProps } from '@mui/material';

export type ButtonIntent = 'primary' | 'secondary' | 'danger' | 'warning' | 'success';

export interface AppButtonProps extends Omit<ButtonProps, 'color'> {
  intent?: ButtonIntent;
  loading?: boolean;
  target?: string;
  rel?: string;
}

const colorByIntent: Record<ButtonIntent, ButtonProps['color']> = {
  primary: 'primary',
  secondary: 'secondary',
  danger: 'error',
  warning: 'warning',
  success: 'success',
};

export function AppButton({
  intent = 'primary',
  loading = false,
  disabled,
  children,
  startIcon,
  variant = 'contained',
  ...props
}: AppButtonProps) {
  return (
    <Button
      {...props}
      variant={variant}
      color={colorByIntent[intent]}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      startIcon={loading ? <CircularProgress size={16} color="inherit" aria-label="処理中" /> : startIcon}
    >
      {children}
    </Button>
  );
}
