import { sb } from 'storybook/test';
import type { Preview } from '@storybook/nextjs-vite';
import { CssBaseline, ThemeProvider } from '@mui/material';
import theme from '../src/theme';
import '../src/app/globals.css';

sb.mock(import('../src/app/actions/authSecurity.ts'));
sb.mock(import('../src/app/actions/auth.ts'));
sb.mock(import('../src/app/actions/internalWork.ts'));
sb.mock(import('../src/app/actions/shiftSegments.ts'));
sb.mock(import('../src/app/actions/serviceTypes.ts'));
sb.mock(import('../src/app/actions/staffRoles.ts'));

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
