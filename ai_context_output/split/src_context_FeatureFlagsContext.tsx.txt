'use client';

import { createContext, useContext, type ReactNode } from 'react';

type FeatureFlags = {
  aiImportEnabled: boolean;
};

const FeatureFlagsContext = createContext<FeatureFlags>({ aiImportEnabled: false });

export function FeatureFlagsProvider({ flags, children }: { flags: FeatureFlags; children: ReactNode }) {
  return <FeatureFlagsContext.Provider value={flags}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext);
}
