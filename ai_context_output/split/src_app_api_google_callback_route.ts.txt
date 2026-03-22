import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { getGoogleOAuthClient } from '@/utils/googleCalendar';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state'); // organizationIdが入っている
  
    const origin = request.nextUrl.origin;
    const redirectUrl = `${origin}/app/settings`; // 処理後に戻る画面

    if (error || !code || !state) {
        console.error('Google OAuth Error or missing params:', error);
        return NextResponse.redirect(`${redirectUrl}?error=google_auth_failed`);
    }

    try {
        const oauth2Client = getGoogleOAuthClient();
        
        // 1. Googleから送られてきたcodeをトークンに交換
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
            console.error('No refresh token received');
            return NextResponse.redirect(`${redirectUrl}?error=no_refresh_token`);
        }

        oauth2Client.setCredentials(tokens);

        // 2. Supabase Admin Client (DBを強制的に更新するため)
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        // 3. 事業所名の取得（カレンダー名に使うため）
        const { data: orgData, error: orgError } = await supabaseAdmin
            .from('organizations')
            .select('name')
            .eq('id', state)
            .single();

        if (orgError || !orgData) throw new Error('Organization not found');

        // 4. Google Calendar API を使って新しいカレンダーを作成
        const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });
        const calendarRes = await calendarApi.calendars.insert({
            requestBody: {
                summary: `CareRecord_${orgData.name}`,
                timeZone: 'Asia/Tokyo',
            }
        });

        const newCalendarId = calendarRes.data.id;
        if (!newCalendarId) throw new Error('Failed to create calendar');

        // 5. DBにリフレッシュトークンとカレンダーIDを保存
        const { error: updateError } = await supabaseAdmin
            .from('organizations')
            .update({
                google_refresh_token: tokens.refresh_token,
                google_calendar_id: newCalendarId
            })
            .eq('id', state);

        if (updateError) throw updateError;

        // 6. 成功したら設定画面へリダイレクト
        return NextResponse.redirect(`${redirectUrl}?success=calendar_connected`);

    } catch (err) {
        console.error('Google Callback Error:', err);
        return NextResponse.redirect(`${redirectUrl}?error=calendar_setup_failed`);
    }
}