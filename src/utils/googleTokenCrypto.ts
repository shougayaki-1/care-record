import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const LEGACY_PREFIX = 'enc:v1';
const PREFIX = 'enc:v2';

function decodeKey(raw: string | undefined, label: string): Buffer {
  if (!raw) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${label} must be a 32-byte base64 value`);
  }
  return key;
}

function getKeyring(): { activeId: string; keys: Record<string, Buffer> } {
  const activeId = process.env.GOOGLE_TOKEN_ACTIVE_KEY_ID || 'legacy';
  const encoded: Record<string, string> = process.env.GOOGLE_TOKEN_ENCRYPTION_KEYS
    ? JSON.parse(process.env.GOOGLE_TOKEN_ENCRYPTION_KEYS)
    : { legacy: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || '' };
  const keys = Object.fromEntries(Object.entries(encoded).map(([id, value]) => [id, decodeKey(value, `Google token key ${id}`)]));
  if (!keys[activeId]) throw new Error('GOOGLE_TOKEN_ACTIVE_KEY_ID is not present in the keyring');
  return { activeId, keys };
}

export function encryptGoogleToken(plainText: string): string {
  const { activeId, keys } = getKeyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys[activeId], iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, activeId, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptGoogleToken(value: string): string {
  const { keys } = getKeyring();
  if (!value.startsWith('enc:')) {
    if (process.env.NODE_ENV === 'production') throw new Error('Plaintext Google token is not accepted');
    return value;
  }

  const parts = value.split(':');
  const legacy = value.startsWith(`${LEGACY_PREFIX}:`);
  if ((legacy && parts.length !== 5) || (!legacy && parts.length !== 6)) throw new Error('Encrypted Google token has an invalid format');
  const keyId = legacy ? 'legacy' : parts[2];
  const offset = legacy ? 2 : 3;
  const key = keys[keyId];
  if (!key) throw new Error(`Google token key ${keyId} is unavailable`);
  const iv = Buffer.from(parts[offset], 'base64url');
  const tag = Buffer.from(parts[offset + 1], 'base64url');
  const encrypted = Buffer.from(parts[offset + 2], 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
