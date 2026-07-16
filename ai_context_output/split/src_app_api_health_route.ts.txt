import { NextResponse } from 'next/server';
import { serviceRoleForIncidentResponse } from '@/utils/supabase/serviceRole';

const supabaseAdmin = serviceRoleForIncidentResponse();

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CapacityLevel = 'normal' | 'warning' | 'restricted' | 'critical';

function isCapacityLevel(value: unknown): value is CapacityLevel {
  return value === 'normal' || value === 'warning' || value === 'restricted' || value === 'critical';
}

export async function GET() {
  const headers = { 'Cache-Control': 'no-store, max-age=0' };
  const { data, error } = await supabaseAdmin.rpc('get_database_capacity_status');
  const level = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>).level
    : undefined;

  if (error || !isCapacityLevel(level)) {
    return NextResponse.json(
      { ok: false, service: 'care-record', status: 'unavailable' },
      { status: 503, headers },
    );
  }

  return NextResponse.json({
    ok: true,
    service: 'care-record',
    status: level === 'normal' ? 'ok' : 'degraded',
    database: { capacity: level },
  }, { status: 200, headers });
}
