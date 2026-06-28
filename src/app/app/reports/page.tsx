import { Suspense } from 'react';
import { TablePageSkeleton } from '@/components/ui/PageSkeletons';
import ReportsClientPage from './ReportsClientPage';

export default function ReportsPage() {
  return (
    <Suspense fallback={<TablePageSkeleton />}>
      <ReportsClientPage />
    </Suspense>
  );
}
