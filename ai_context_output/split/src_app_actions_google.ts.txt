'use server';

import { getGoogleOAuthClient } from '@/utils/googleCalendar';

export async function getGoogleAuthUrlAction(organizationId: string) {
    const oauth2Client = getGoogleOAuthClient();

    // カレンダーの読み書き権限を要求
    const scopes = [
        'https://www.googleapis.com/auth/calendar'
    ];

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline', // リフレッシュトークンを取得するために必須
        prompt: 'consent',      // 確実に同意画面を出してリフレッシュトークンをもらうため
        scope: scopes,
        state: organizationId,  // コールバック時に「どの事業所からのリクエストか」を特定するための目印
    });

    return url;
}