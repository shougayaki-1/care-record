import { NextRequest, NextResponse } from 'next/server';
import { serviceRoleForAuditPreservation } from '@/utils/supabase/serviceRole';

const supabaseAdmin = serviceRoleForAuditPreservation();

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  return !!process.env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin.rpc('verify_audit_chain');
  if (error) return NextResponse.json({ error: 'verification_failed' }, { status: 500 });

  const mismatches = data ?? [];
  if (mismatches.length > 0) {
    return NextResponse.json({
      ok: false,
      mismatchCount: mismatches.length,
      firstMismatch: mismatches[0],
    }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
