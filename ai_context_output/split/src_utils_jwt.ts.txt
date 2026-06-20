/**
 * JWTのpayloadをBase64URLとしてデコードする。
 * 署名検証は行わないため、必ずAuthサーバーでトークン検証した後に使うこと。
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function decodeJwtSessionId(token: string): string | null {
  const sessionId = decodeJwtPayload(token)?.session_id;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}
