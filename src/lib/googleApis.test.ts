import { describe, expect, it } from 'vitest';
import { google } from './googleApis';

describe('scoped Google API clients', () => {
  it('preserves OAuth configuration for Calendar and Cloud Logging without network access', () => {
    const auth = new google.auth.OAuth2('local-client', 'local-secret', 'http://localhost/callback');
    auth.setCredentials({ refresh_token: 'local-refresh-token' });
    const consent = new URL(auth.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      state: 'local-nonce',
    }));
    expect(consent.searchParams.get('redirect_uri')).toBe('http://localhost/callback');
    expect(consent.searchParams.get('state')).toBe('local-nonce');
    expect(consent.searchParams.get('access_type')).toBe('offline');

    const calendar = google.calendar({ version: 'v3', auth });
    const logging = google.logging({ version: 'v2', auth });
    expect(calendar.context._options.auth).toBe(auth);
    expect(logging.context._options.auth).toBe(auth);
    expect(auth.credentials.refresh_token).toBe('local-refresh-token');
    expect(typeof calendar.events.list).toBe('function');
    expect(typeof calendar.events.delete).toBe('function');
    expect(typeof logging.entries.list).toBe('function');
  });
});
