import { google } from 'googleapis';

// OAuth の CSRF 対策用 state(nonce)+orgId を保持する httpOnly Cookie 名
export const OAUTH_STATE_COOKIE = 'g_oauth_state';

export const getGoogleOAuthClient = () => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
        throw new Error('Google OAuth environment variables are missing.');
    }

    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
};