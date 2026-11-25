import { ArchiveFailure } from '@/utils/auditArchive/contracts';

export async function withinDeadline<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ArchiveFailure('incomplete');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ArchiveFailure('incomplete')), remaining); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
