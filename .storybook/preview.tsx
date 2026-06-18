import type { Preview } from '@storybook/nextjs-vite';
import { CssBaseline, ThemeProvider } from '@mui/material';
import theme from '../src/theme';
import '../src/app/globals.css';

const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Story />
      </ThemeProvider>
    ),
  ],
  parameters: {
    nextjs: { appDirectory: true },
    layout: 'centered',
    a11y: { test: 'error' },
    controls: { expanded: true },
  },
};

export default preview;

