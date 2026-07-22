import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createServerClient } from '@supabase/ssr';
import { getGoogleOAuthClient, OAUTH_STATE_COOKIE } from '@/utils/googleCalendar';
import { encryptGoogleToken } from '@/utils/googleTokenCrypto';
import { consumeOAuthNonce } from '@/utils/supabase/oauthNonce';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { logExternalError } from '@/utils/errors';
import type { Database } from '@/types/database.generated';
import { areExternalIntegrationsEnabled } from '@/lib/env/server';

export async function GET(request: NextRequest) {
    if (!areExternalIntegrationsEnabled()) {
        return NextResponse.json({ error: 'external_integrations_disabled' }, { status: 404 });
    }
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state'); // CSRF 対策の nonce

    const origin = request.nextUrl.origin;
    const redirectUrl = `${origin}/app/settings`; // 処理後に戻る画面

    if (error || !code || !state) {
        console.error('Google OAuth Error or missing params:', error);
        return NextResponse.redirect(`${redirectUrl}?error=google_auth_failed`);
    }

    // 1. CSRF 検証: state(nonce) を Cookie と突合し、orgId は Cookie から取得する
    const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    const failResponse = NextResponse.redirect(`${redirectUrl}?error=invalid_oauth_state`);
    failResponse.cookies.delete(OAUTH_STATE_COOKIE);

    if (!stateCookie) {
        console.error('Missing OAuth state cookie');
        return failResponse;
    }
    const sepIndex = stateCookie.indexOf(':');
    const nonce = sepIndex >= 0 ? stateCookie.slice(0, sepIndex) : '';
    const organizationId = sepIndex >= 0 ? stateCookie.slice(sepIndex + 1) : '';
    if (!nonce || !organizationId || nonce !== state) {
        console.error('OAuth state mismatch');
        return failResponse;
    }

    try {
        // 2. ログイン中ユーザーを検証し、当該事業所の owner であることを確認
        const supabaseSession = createServerClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll: () => request.cookies.getAll(),
                    setAll: () => { /* 認証状態の確認のみ。Cookie 書き込みは不要 */ },
                },
            }
        );
        const { data: { user } } = await supabaseSession.auth.getUser();
        if (!user) {
            return NextResponse.redirect(`${origin}/?error=not_authenticated`);
        }

        const { data: oauthContext, error: contextError } = await supabaseSession.rpc('get_google_oauth_context', {
            p_org_id: organizationId,
        });
        if (contextError || !oauthContext || typeof oauthContext !== 'object') {
            console.error('User cannot manage integrations for target organization');
            return failResponse;
        }
        const oauthNonce = await consumeOAuthNonce({
            nonce: state,
            provider: 'google-calendar',
            userId: user.id,
            organizationId,
        });
        if (!oauthNonce) {
            console.error('OAuth state was expired or already consumed');
            return failResponse;
        }

        const oauth2Client = getGoogleOAuthClient();

        // 3. Googleから送られてきたcodeをトークンに交換
        const { tokens } = await oauth2Client.getToken(code);

        // For Google SSO-only users, this Calendar authorization is also the
        // required step-up. Verify that the Google account is the same one
        // used to sign in to CareRecord before accepting its refresh token.
        if (oauthNonce.requiresGoogleIdentityMatch) {
            if (!tokens.id_token) throw new Error('Google本人確認トークンを取得できませんでした');
            const ticket = await oauth2Client.verifyIdToken({
                idToken: tokens.id_token,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            const googleSubject = ticket.getPayload()?.sub;
            const linkedGoogleSubject = user.identities
                ?.find((identity) => identity.provider === 'google')
                ?.identity_data?.sub;
            if (!googleSubject || googleSubject !== linkedGoogleSubject) {
                throw new Error('ログインに使用したGoogleアカウントを選択してください');
            }
        }

        if (!tokens.refresh_token) {
            console.error('No refresh token received');
            return NextResponse.redirect(`${redirectUrl}?error=no_refresh_token`);
        }

        oauth2Client.setCredentials(tokens);

        // 4. 事業所名の取得（カレンダー名に使うため）
        const orgData = oauthContext as { name: string; google_calendar_id: string | null };

        // 5. Keep the existing calendar whenever reauthorization succeeds.
        // Creating a new calendar silently makes existing event IDs point at the
        // wrong remote calendar and falsely reports everything as synchronized.
        const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });
        let calendarId = orgData.google_calendar_id;
        let connectionStatus = 'healthy';
        if (calendarId) {
            try {
                await calendarApi.calendars.get({ calendarId });
            } catch (calendarError) {
                // Keep the old ID for an explicit, audited replacement flow.
                // A different Google account must never create a replacement
                // calendar implicitly during reauthorization.
                logExternalError('google.callback.calendar-check', calendarError);
                connectionStatus = 'calendar_missing';
            }
        } else {
            const calendarRes = await calendarApi.calendars.insert({
                requestBody: {
                    summary: `CareRecord_${orgData.name}`,
                    timeZone: 'Asia/Tokyo',
                }
            });
            calendarId = calendarRes.data.id || null;
            if (!calendarId) throw new Error('Failed to create calendar');
        }

        // 6. Persist the token and connection health. Calendar replacement is
        // deliberately a separate explicit action.
        const { error: updateError } = await supabaseSession.rpc('complete_google_oauth_connection', {
            p_org_id: organizationId,
            p_encrypted_refresh_token: encryptGoogleToken(tokens.refresh_token),
            p_calendar_id: calendarId,
            p_status: connectionStatus,
        });

        if (updateError) throw updateError;

        await recordAuditEvent({
            organizationId,
            actorId: user.id,
            action: 'integration.calendar.connect',
            resourceType: 'organization',
            resourceId: organizationId,
            details: { connectionStatus, reusedCalendar: Boolean(orgData.google_calendar_id) },
        });

        // 7. 成功したら設定画面へリダイレクト（使い捨て state Cookie を破棄）
        const okResponse = NextResponse.redirect(`${redirectUrl}?${connectionStatus === 'healthy' ? 'success=calendar_connected' : 'error=google_calendar_missing'}`);
        okResponse.cookies.delete(OAUTH_STATE_COOKIE);
        return okResponse;

    } catch (err) {
        logExternalError('google.callback', err);
        const errResponse = NextResponse.redirect(`${redirectUrl}?error=calendar_setup_failed`);
        errResponse.cookies.delete(OAUTH_STATE_COOKIE);
        return errResponse;
    }
}
