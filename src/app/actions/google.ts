'use server';

import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { getGoogleOAuthClient, OAUTH_STATE_COOKIE } from '@/utils/googleCalendar';
import { assertOrgPermission, createSessionClient } from '@/utils/supabase/auth';
import { storeOAuthNonce } from '@/utils/supabase/oauthNonce';
import { decryptGoogleToken } from '@/utils/googleTokenCrypto';
import { google } from 'googleapis';
import { classifyGoogleError } from '@/utils/googleSync';
import { sanitizeDbError, withSafeError } from '@/utils/errors';
import { consumeReauthGrant } from '@/utils/supabase/reauth';

export type GoogleConnectionState = 'disconnected' | 'healthy' | 'reauth_required' | 'calendar_missing' | 'forbidden' | 'misconfigured' | 'temporarily_unavailable';

export async function getGoogleConnectionHealth(organizationId: string): Promise<{ state: GoogleConnectionState }> {
    return withSafeError('getGoogleConnectionHealth', async () => {
    await assertOrgPermission(organizationId, 'integrations');
    const supabase = await createSessionClient();
    const { data: org, error } = await supabase
        .from('organizations')
        .select('google_calendar_id, google_refresh_token')
        .eq('id', organizationId)
        .single();
    if (error) throw sanitizeDbError(error, 'action.google.health');
    if (!org?.google_calendar_id || !org.google_refresh_token) return { state: 'disconnected' };
    let state: GoogleConnectionState = 'healthy';
    try {
        const oauth = getGoogleOAuthClient();
        oauth.setCredentials({ refresh_token: decryptGoogleToken(org.google_refresh_token) });
        await google.calendar({ version: 'v3', auth: oauth }).calendars.get({ calendarId: org.google_calendar_id });
    } catch (error) {
        const classified = classifyGoogleError(error);
        state = classified.kind === 'auth' ? 'reauth_required'
            : classified.kind === 'rate_limit' || classified.kind === 'transient' ? 'temporarily_unavailable'
            : classified.code === 404 ? 'calendar_missing'
            : 'misconfigured';
    }
    const { error: updateError } = await supabase.rpc('update_google_connection_health', {
        p_org_id: organizationId, p_status: state, p_error_code: state === 'healthy' ? null : state,
    });
    if (updateError) throw sanitizeDbError(updateError, 'action.google.health-update');
    return { state };
    });
}

export async function getGoogleAuthUrlAction(
    organizationId: string,
    mode: 'connect' | 'reauthorize',
    reauthToken: string,
) {
    return withSafeError('getGoogleAuthUrlAction', async () => {
    const { userId } = await assertOrgPermission(organizationId, 'integrations');
    const reauth = await consumeReauthGrant('external_secret_change', reauthToken);
    if (reauth.userId !== userId) throw new Error('再認証した利用者が一致しません');

    // CSRF 対策: 推測不能な nonce を生成し、orgId と紐づけて httpOnly Cookie に保存。
    // コールバック時に state(nonce) と Cookie を突合し、orgId は Cookie 側を信頼する。
    const nonce = randomBytes(32).toString('hex');
    await storeOAuthNonce({ nonce, provider: 'google-calendar', userId, organizationId, mode });
    const cookieStore = await cookies();
    cookieStore.set(OAUTH_STATE_COOKIE, `${nonce}:${organizationId}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 10, // 10分
    });

    const oauth2Client = getGoogleOAuthClient();

    // カレンダーの読み書き権限を要求
    const scopes = [
        'https://www.googleapis.com/auth/calendar'
    ];

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline', // リフレッシュトークンを取得するために必須
        prompt: 'consent',      // 確実に同意画面を出してリフレッシュトークンをもらうため
        scope: scopes,
        state: nonce,           // 推測不能な nonce のみを渡す（orgId は Cookie で保持）
    });

    return url;
    });
}
