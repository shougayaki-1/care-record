import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/utils/supabase/auth';
import { uploadToGCS } from '@/utils/gcs/upload';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const DESTINATION = 'primary-worm';
const GCS_BUCKET = 'care-record-archive-7y';

function authorized(request: NextRequest): boolean {
  return !!process.env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const gcsEnabled = !!process.env.GCP_SERVICE_ACCOUNT_KEY_JSON;
  const hmacEndpoint = process.env.AUDIT_ARCHIVE_URL;
  const hmacSecret = process.env.AUDIT_ARCHIVE_HMAC_SECRET;
  const hmacEnabled = !!(hmacEndpoint && hmacSecret);
  if (!gcsEnabled && !hmacEnabled) return NextResponse.json({ error: 'archive_not_configured' }, { status: 503 });

  const { data: checkpoint } = await supabaseAdmin.from('audit_archive_checkpoints')
    .select('last_created_at,last_event_id').eq('destination', DESTINATION).maybeSingle();
  let query = supabaseAdmin.from('audit_events').select('*').not('event_hash', 'is', null)
    .order('created_at', { ascending: true }).order('event_id', { ascending: true }).limit(500);
  if (checkpoint?.last_created_at) query = query.gte('created_at', checkpoint.last_created_at);
  const { data: rawEvents, error } = await query;
  if (error) return NextResponse.json({ error: 'audit_read_failed' }, { status: 500 });
  const events = (rawEvents || []).filter((event) =>
    !checkpoint?.last_created_at || event.created_at > checkpoint.last_created_at || event.event_id !== checkpoint.last_event_id
  );
  if (events.length === 0) return NextResponse.json({ ok: true, archived: 0 });

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({ schemaVersion: 1, exportedAt, events });

  if (gcsEnabled) {
    const ts = exportedAt.replace(/[:.]/g, '-');
    const ym = exportedAt.slice(0, 7);
    try {
      await uploadToGCS(GCS_BUCKET, `audit/${ym}/${ts}.json`, body);
    } catch (err) {
      console.error('[cron:archive-audit] GCS upload failed', err);
      return NextResponse.json({ error: 'gcs_upload_failed' }, { status: 500 });
    }
  }

  if (hmacEnabled) {
    const signature = createHmac('sha256', hmacSecret!).update(body).digest('hex');
    const response = await fetch(hmacEndpoint!, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-CareRecord-Signature': signature,
    }, body, cache: 'no-store' });
    if (!response.ok) return NextResponse.json({ error: 'archive_write_failed' }, { status: 502 });
  }

  const last = events[events.length - 1];
  const { error: checkpointError } = await supabaseAdmin.from('audit_archive_checkpoints').upsert({
    destination: DESTINATION, last_created_at: last.created_at, last_event_id: last.event_id, updated_at: new Date().toISOString(),
  });
  if (checkpointError) return NextResponse.json({ error: 'checkpoint_write_failed' }, { status: 500 });
  await supabaseAdmin.from('audit_events').insert({ organization_id: null, actor_id: null,
    action_type: 'audit.archive', resource_type: 'audit', outcome: 'success', details: { count: events.length, lastEventId: last.event_id },
  });
  return NextResponse.json({ ok: true, archived: events.length });
}
