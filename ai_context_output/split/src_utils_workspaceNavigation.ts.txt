import type { WorkspaceLoadStatus } from '@/context/WorkspaceContext';

export type AppDestination = '/setup' | '/' | '/app/record' | null;

export function resolveAppDestination(status: WorkspaceLoadStatus, hasCurrentOrganization: boolean): AppDestination {
  if (status === 'no_membership') return '/setup';
  if (status === 'session_expired') return '/';
  if (status === 'ready' && hasCurrentOrganization) return '/app/record';
  return null;
}
