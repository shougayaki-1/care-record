'use client';

import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/mui';
import { getMcpReportRemandReason } from '@/app/actions/mcpReportTransition';
import { readActionResult } from '@/utils/actionResult';

export function McpRemandReason({ organizationId, reportId }: { organizationId: string; reportId: string }) {
  const [state, setState] = useState<{ reason: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void readActionResult(getMcpReportRemandReason(organizationId, reportId))
      .then(reason => { if (active) setState({ reason, failed: false }); })
      .catch(() => { if (active) setState({ reason: null, failed: true }); });
    return () => { active = false; };
  }, [organizationId, reportId]);
  if (state?.failed) return <Alert severity="warning">差戻し理由を確認できませんでした。通信とアクセス権限を確認してください。</Alert>;
  if (!state?.reason) return null;
  return <Alert severity="warning" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>差戻し理由: {state.reason}</Alert>;
}
