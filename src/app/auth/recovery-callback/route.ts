import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/types/database.generated';
import { registerSessionActivity } from '@/utils/supabase/auth';
import { issueGrantToken } from '@/utils/supabase/reauth';
import { RECOVERY_GRANT_COOKIE } from '@/utils/passwordRecovery';
import { REAUTH_GRANT_TTL_MINUTES } from '@/utils/authConstants';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  // A relative Location preserves the actual browser origin even when NextURL
  // normalizes 127.0.0.1 to localhost. No Host/next input becomes a redirect host.
  const response = new NextResponse(null, { status: 303, headers: { Location: '/auth/reset-password?error=invalid_link' } });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(RECOVERY_GRANT_COOKIE, '', { path: '/auth', maxAge: 0 });
  // A dedicated recovery email template sends token_hash; OAuth/login codes
  // cannot be repurposed as recovery evidence. next and provider errors are ignored.
  if (!tokenHash || url.searchParams.get('type') !== 'recovery') return response;
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: values => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    },
  );
  try {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
    if (error || !data.session) return response;
    const sessionId = await registerSessionActivity(data.session);
    const { token } = await issueGrantToken('account_password_reset', data.session.user.id, sessionId);
    response.cookies.set(RECOVERY_GRANT_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/auth',
      maxAge: REAUTH_GRANT_TTL_MINUTES * 60,
    });
    response.headers.set('Location', '/auth/reset-password');
  } catch {
    console.warn('[auth] Password recovery verification failed');
  }
  return response;
}
