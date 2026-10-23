import { useEffect, useRef, useState } from 'react';

// A dialog instance belongs to one organization/target. Ignore its late response
// after that instance is replaced, and synchronously lock repeated submissions.
export function useAccountOperation() {
  const mounted = useRef(true);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (operation: (isCurrent: () => boolean) => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await operation(() => mounted.current); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return { busy, run };
}
