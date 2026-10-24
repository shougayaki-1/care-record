import { fn } from 'storybook/test';
import type * as Workspace from '../WorkspaceContext';

export const useWorkspace = fn<typeof Workspace.useWorkspace>();
