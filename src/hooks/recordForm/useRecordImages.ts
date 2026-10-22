'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportImages } from '@/app/actions/reports';
import { readActionResult } from '@/utils/actionResult';
import { measureRecordLoad } from '@/utils/recordLoadTiming';

type RecordImage = { id: string; url: string };
type ImageState = {
  scope: string;
  attempt: number;
  generation: number;
  images: RecordImage[];
  error: unknown;
};

type RecordImagesOptions = {
  scopeKey: string;
  organizationId: string | undefined;
  reportId: string | null;
  loading: boolean;
  generation: number | undefined;
};

/** Fetch attachments after the audited body is ready, with independent retries. */
export function useRecordImages({ scopeKey, organizationId, reportId, loading, generation }: RecordImagesOptions) {
  const [state, setState] = useState<ImageState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retryImages = useCallback(() => setAttempt(value => value + 1), []);
  const current = !loading && state?.scope === scopeKey && state.attempt === attempt && state.generation === generation;
  const imagesError = current ? state.error : null;

  useEffect(() => {
    if (loading || !organizationId || !reportId || generation === undefined) return;
    let cancelled = false;
    void measureRecordLoad('images', () => readActionResult(getReportImages(organizationId, reportId)))
      .then(images => {
        if (!cancelled) setState({ scope: scopeKey, generation, attempt, images, error: null });
      }).catch((error: unknown) => {
        if (!cancelled) setState({ scope: scopeKey, generation, attempt, images: [], error });
      });
    return () => { cancelled = true; };
  }, [loading, organizationId, reportId, scopeKey, generation, attempt]);

  return {
    images: current && !imagesError ? state.images : [],
    imagesLoading: Boolean(reportId && !loading && !current),
    imagesError,
    retryImages,
  };
}
