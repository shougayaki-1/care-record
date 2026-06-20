import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, decodeJwtSessionId } from './jwt';

function tokenFor(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

describe('JWT payload decoder', () => {
  it('Base64URLのpaddingなしpayloadからsession_idを取得する', () => {
    expect(decodeJwtSessionId(tokenFor({ session_id: 'session-123' }))).toBe('session-123');
  });

  it('UTF-8のpayloadを復元する', () => {
    expect(decodeJwtPayload(tokenFor({ name: '介護記録' }))?.name).toBe('介護記録');
  });

  it('不正なtokenはnullを返す', () => {
    expect(decodeJwtPayload('invalid-token')).toBeNull();
    expect(decodeJwtSessionId(tokenFor({ session_id: 123 }))).toBeNull();
  });
});
