'use client';

import { useEffect } from 'react';

/** 過去に配布したPWA Service WorkerとNext.jsチャンクキャッシュを除去する。 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    void (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
    })().catch((error) => {
      console.warn('Service Worker cleanup failed', error);
    });
  }, []);

  return null;
}
