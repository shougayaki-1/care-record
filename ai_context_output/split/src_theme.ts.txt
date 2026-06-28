'use client';

import { alpha, createTheme } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface TypeBackground {
    subtle: string;
    tint: string;
    muted: string;
    danger: string;
    warning: string;
    success: string;
    aiHighlight: string;
  }
}

export const designTokens = {
  brand: {
    main: '#1A73E8',
    light: '#4285F4',
    dark: '#1557B0',
  },
  surface: {
    canvas: '#FFFFFF',
    paper: '#FFFFFF',
    subtle: '#FAFAFA',
    tint: '#E8F0FE',
    muted: '#F2F3F5',
  },
  status: {
    danger: '#FFF5F5',
    warning: '#FFF8E1',
    success: '#F1F8E9',
    aiHighlight: '#FFFDE7',
  },
  border: {
    default: '#E3E5E8',
    strong: '#D0D4DB',
  },
  radius: {
    control: 8,
    card: 12,
    dialog: 28,
    chip: 8,
  },
  shadow: {
    floating: '0 8px 32px rgba(30, 42, 70, 0.12)',
  },
} as const;

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: designTokens.brand,
    secondary: { main: '#6C5CE7' },
    success: { main: '#2E7D32' },
    error: { main: '#D32F2F', light: '#FFEBEE' },
    warning: { main: '#9A4A00', light: designTokens.status.warning, contrastText: '#FFFFFF' },
    background: {
      default: designTokens.surface.canvas,
      paper: designTokens.surface.paper,
      subtle: designTokens.surface.subtle,
      tint: designTokens.surface.tint,
      muted: designTokens.surface.muted,
      danger: designTokens.status.danger,
      warning: designTokens.status.warning,
      success: designTokens.status.success,
      aiHighlight: designTokens.status.aiHighlight,
    },
    divider: designTokens.border.default,
    text: { primary: '#2C3E50', secondary: '#636E72' },
  },
  shape: { borderRadius: designTokens.radius.card },
  typography: {
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 700 },
    button: { fontWeight: 600, textTransform: 'none' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':focus-visible': {
          outline: `3px solid ${alpha(designTokens.brand.main, 0.3)}`,
          outlineOffset: 2,
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 36, borderRadius: designTokens.radius.control, paddingInline: 16 },
      },
    },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { minHeight: 40, borderRadius: designTokens.radius.control },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none' } },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderColor: designTokens.border.default, boxShadow: 'none' } },
    },
    MuiDialog: {
      defaultProps: { fullWidth: true },
      styleOverrides: {
        paper: { borderRadius: designTokens.radius.dialog, boxShadow: designTokens.shadow.floating },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontWeight: 700, padding: '20px 24px 12px' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '12px 24px 20px', gap: 8 } } },
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { borderRadius: designTokens.radius.chip, fontWeight: 600 } },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: designTokens.radius.control } } },
    MuiTableHead: {
      styleOverrides: {
        root: { backgroundColor: designTokens.surface.tint },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { color: '#5C5E66', fontWeight: 700 },
      },
    },
    MuiTableContainer: {
      styleOverrides: { root: { boxShadow: 'none' } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: {
          backgroundColor: designTokens.surface.paper,
          color: '#2C3E50',
          borderBottom: `1px solid ${designTokens.border.default}`,
        },
      },
    },
  },
});

export default theme;
