import AppLayout from '@/components/layout/AppLayout';
import { isAiImportEnabled } from '@/lib/env/server';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppLayout aiImportEnabled={isAiImportEnabled()}>{children}</AppLayout>;
}
