import { notFound } from 'next/navigation';
import { isAiImportEnabled } from '@/lib/env/server';

export default function AiImportLayout({ children }: { children: React.ReactNode }) {
  if (!isAiImportEnabled()) notFound();
  return children;
}
