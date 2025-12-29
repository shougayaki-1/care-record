// src/theme.ts
'use client';
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#2255CC', // メインカラー
            light: '#6699FF',
            dark: '#003399',
        },
        background: {
            default: '#f8f9fa', // 全体の背景色
            paper: '#ffffff',
        },
        text: {
            primary: '#2c3e50',
            secondary: '#636e72',
        },
    },
    shape: {
        borderRadius: 12, // 角丸を強めにしてモダンに
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
                    '&:hover': { boxShadow: '0 4px 8px rgba(34, 85, 204, 0.2)' },
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