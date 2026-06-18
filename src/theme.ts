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
            default: '#ffffff', // 全体の背景色（Google風の白基調）
            paper: '#ffffff',
        },
        divider: '#e0e0e0',
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
        // Google風のフラットなトップバー：白背景・影なし・下境界線で区切る
        MuiAppBar: {
            defaultProps: {
                elevation: 0,
                color: 'inherit',
            },
            styleOverrides: {
                root: {
                    backgroundColor: '#ffffff',
                    color: '#2c3e50',
                    borderBottom: '1px solid #e0e0e0',
                },
            },
        },
    },
});

export default theme;