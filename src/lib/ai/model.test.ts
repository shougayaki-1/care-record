import { describe, expect, it, vi } from 'vitest';

describe('MODEL_NAME', () => {
  it('VERTEX_AI_MODEL 未設定時は gemini-3.5-flash を使う', async () => {
    vi.resetModules();
    vi.stubEnv('VERTEX_AI_MODEL', '');

    const { MODEL_NAME } = await import('./model');

    expect(MODEL_NAME).toBe('gemini-3.5-flash');
    vi.unstubAllEnvs();
  });
});
