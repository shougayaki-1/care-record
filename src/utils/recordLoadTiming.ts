/** Fixed stage names only: never include report IDs, values, or signed URLs. */
export async function measureRecordLoad<T>(
  stage: 'base' | 'report' | 'values' | 'actual-staffs' | 'audit' | 'images' | 'ready',
  task: () => PromiseLike<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await task();
  } finally {
    const name = `record-load:${stage}`;
    // Bound retained entries on long-running tabs. DevTools can record a trace.
    performance.clearMeasures(name);
    performance.measure(name, { start, duration: performance.now() - start });
  }
}

/** Called on the first animation frame containing the loaded form. */
export function markRecordBodyVisible() {
  const ready = performance.getEntriesByName('record-load:ready', 'measure').at(-1);
  if (!ready) return;
  performance.clearMeasures('record-load:body-visible');
  performance.measure('record-load:body-visible', { start: ready.startTime, end: performance.now() });
}
