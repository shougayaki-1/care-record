import { Suspense } from 'react';
import { TablePageSkeleton } from '@/components/ui';
import DeletionRequestsClientPage from './DeletionRequestsClientPage';

export default function DeletionRequestsPage() {
  return <Suspense fallback={<TablePageSkeleton />}><DeletionRequestsClientPage /></Suspense>;
}
