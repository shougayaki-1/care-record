// src/theme.ts
'use client';
import { createTheme } from '@mui/material/styles';
import { brand, neutral, text, status, radius } from './styles/tokens';

// --- TypeScript module augmentation -------------------------------------
// tokens 由来のカスタム palette を MUI に型として認識させる。
declare module '@mui/material/styles' {
    interface Palette {
        neutral: Palette['primary'];
    }
    interface PaletteOptions {
        neutral?: PaletteOptions['primary'];
    }
}
// Button などの color プロップで color="neutral" を使えるようにする。
declare module '@mui/material/Button' {
    interface ButtonPropsColorOverrides {
        neutral: true;
    }
}
// ------------------------------------------------------------------------

const theme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: brand.primary,
            light: brand.primaryLight,
            dark: brand.primaryDark,
        },
        success: {
            main: status.success.main,
        },
        warning: {
            main: status.warning.main,
        },
        error: {
            main: status.error.main,
            dark: status.error.dark,
        },
        neutral: {
            main: neutral.surface,
            contrastText: text.primary,
        },
        background: {
            default: neutral.bg, // 全体の背景色
            paper: neutral.white,
        },
        text: {
            primary: text.primary,
            secondary: text.secondaryAlt,
        },
        divider: neutral.border,
    },
    shape: {
        borderRadius: radius.md, // 角丸を強めにしてモダンに
    },
    typography: {
        fontFamily: '"Helvetica Neue", Arial, sans-serif',
        h5: { fontWeight: 700 },
        h6: { fontWeight: 700 },
        button: { fontWeight: 600, textTransform: 'none' },
    },
    components: {
        MuiButton: {
            styleOverrides: {
                root: {
                    boxShadow: 'none',
                    '&:hover': { boxShadow: `0 4px 8px rgba(34, 85, 204, 0.2)` },
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: { backgroundImage: 'none' }, // ダークモード時の透過防止
            },
        },
    },
});

export default theme;
