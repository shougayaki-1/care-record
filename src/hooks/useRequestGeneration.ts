'use client';

import { useCallback, useRef } from 'react';

/**
 * Tracks the newest request in one async lane.
 *
 * Create a separate instance for requests that are allowed to run in parallel.
 * Call invalidate when the data scope changes or the owning effect is cleaned up.
 */
export function useRequestGeneration() {
  const generationRef = useRef(0);

  const next = useCallback(() => ++generationRef.current, []);
  const invalidate = useCallback(() => {
    generationRef.current += 1;
  }, []);
  const isCurrent = useCallback((generation: number) => generation === generationRef.current, []);

  return { next, invalidate, isCurrent } as const;
}
