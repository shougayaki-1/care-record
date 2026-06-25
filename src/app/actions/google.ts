'use server';

import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { getGoogleOAuthClient, OAUTH_STATE_COOKIE } from '@/utils/googleCalendar';
import { assertOrgPermission } from '@/utils/supabase/auth';
import { storeOAuthNonce } from '@/utils/supabase/oauthNonce';

export async function getGoogleAuthUrlAction(organizationId: string) {
    const { userId } = await assertOrgPermission(organizationId, 'integrations');

    // CSRF 対策: 推測不能な nonce を生成し、orgId と紐づけて httpOnly Cookie に保存。
    // コールバック時に state(nonce) と Cookie を突合し、orgId は Cookie 側を信頼する。
    const nonce = randomBytes(32).toString('hex');
    await storeOAuthNonce({ nonce, provider: 'google-calendar', userId, organizationId });
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
}
