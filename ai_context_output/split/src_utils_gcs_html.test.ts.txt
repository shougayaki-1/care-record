import { describe, expect, it } from 'vitest';

import { generateBackupHtml } from './html';

describe('generateBackupHtml', () => {
  it('renders user-controlled names through textContent and script-safe JSON', () => {
    const payload = '<img src=x onerror=alert(1)></script><script>alert(2)</script>';
    const html = generateBackupHtml('2026-07-14', [{
      id: 'report-1', clientName: payload, helperName: payload,
      startAt: '2026-07-14T00:00:00Z', endAt: '2026-07-14T01:00:00Z', status: 'approved',
    }]);

    expect(html).not.toContain(payload);
    expect(html).not.toContain('tbody.innerHTML=rows.map');
    expect(html).toContain('cell.textContent=String(value??\'\')');
    expect(html).toContain('tbody.replaceChildren');
    expect(html).toContain('\\u003cimg');
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
  });
});
