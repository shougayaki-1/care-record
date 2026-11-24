import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregateByTab, summarizeStatisticsRows } from './statisticsAggregation';
import { summarizeKpiSource, type StatisticsKpiSource } from './statisticsKpiSource';

// Run explicitly with a projection generated from the synthetic local DB fixture.
describe.skipIf(!process.env.MCP_KPI_SYNTHETIC_PROJECTION)('MCP KPI database parity', () => {
  it('matches the statistics screen on the same synthetic rows', () => {
    const source = JSON.parse(readFileSync(process.env.MCP_KPI_SYNTHETIC_PROJECTION!, 'utf8')) as StatisticsKpiSource;
    const actual = summarizeKpiSource('2026-07', source);
    const start_at = '2026-07-01T00:00:00+09:00';
    const end_at = '2026-07-01T02:00:00+09:00';
    const screen = aggregateByTab({ targetMonth: '2026-07', premiumTypes: [], internalWorkRecords: [],
      rawShifts: [{ id: 'synthetic-shift', start_at, end_at, status: 'published', client_id: 'synthetic-client', clients: { name: 'Synthetic client' }, shift_staffs: [] }],
      rawReports: [{ id: 'synthetic-report', start_at, end_at, status: 'pending', client_id: 'synthetic-client', clients: { name: 'Synthetic client' },
        report_values: [{ data: { service_time: 1, travel_time: 0.5, _helpers: ['A', 'B'] } }] }],
    });
    expect(actual.byStaff).toEqual(summarizeStatisticsRows(screen.byStaff.rows));
    expect(actual.byClient).toEqual(summarizeStatisticsRows(screen.byClient.rows));
  });
});
