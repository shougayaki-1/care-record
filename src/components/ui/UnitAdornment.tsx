import { InputAdornment, Typography } from '@mui/material';

export function UnitAdornment({ children }: { children: string }) {
  return (
    <InputAdornment position="end" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
      <Typography variant="caption" color="text.secondary">{children}</Typography>
    </InputAdornment>
  );
}
