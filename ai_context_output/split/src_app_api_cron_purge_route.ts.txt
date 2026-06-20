import { NextResponse, type NextRequest } from 'next/server';
import { purgeExpiredRecords } from '@/utils/supabase/retention';

// 保持期間切れデータの物理消去ジョブ（日次）。
// Vercel Cron からは Authorization: Bearer <CRON_SECRET> が付与される。
// 手動ドライラン: GET /api/cron/purge?dryRun=1  (件数のみ集計、削除しない)
export const dynamic = 'force-dynamic';
// Vercel Hobby の関数実行時間上限（最大60秒）まで引き上げる。
// 1回あたりの処理件数は retention.ts 側で上限を設けているため、これで収まる。
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 未設定環境では実行させない（安全側）。
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  try {
    const summary = await purgeExpiredRecords(dryRun);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error('[cron:purge]', err);
    return NextResponse.json({ ok: false, error: 'purge_failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
