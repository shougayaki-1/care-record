import { ArchiveFailure } from '@/utils/auditArchive/contracts';

export async function withinDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ArchiveFailure('incomplete');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        reject(new ArchiveFailure('incomplete'));
        controller.abort();
      }, remaining); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
