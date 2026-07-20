import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CapacityLevel = 'normal' | 'warning' | 'restricted' | 'critical';

function isCapacityLevel(value: unknown): value is CapacityLevel {
  return value === 'normal' || value === 'warning' || value === 'restricted' || value === 'critical';
}

export async function GET() {
  const headers = { 'Cache-Control': 'no-store, max-age=0' };
  const unavailable = () => NextResponse.json(
    { ok: false, service: 'care-record', status: 'unavailable' },
    { status: 503, headers },
  );

  let data: unknown;
  let error: unknown;
  try {
    // Imported lazily so a configuration/initialization failure (e.g. a missing
    // service-role env var, which throws at module load in auth.ts) degrades to a
    // controlled 503 here instead of surfacing as an uncaught 500. The health
    // endpoint must never itself 500 — that is what confused the deploy probe.
    const { serviceRoleForIncidentResponse } = await import('@/utils/supabase/serviceRole');
    ({ data, error } = await serviceRoleForIncidentResponse().rpc('get_database_capacity_status'));
  } catch {
    return unavailable();
  }

  const level = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>).level
    : undefined;

  if (error || !isCapacityLevel(level)) {
    return unavailable();
  }

  return NextResponse.json({
    ok: true,
    service: 'care-record',
    status: level === 'normal' ? 'ok' : 'degraded',
    database: { capacity: level },
  }, { status: 200, headers });
}
