import { beforeEach, describe, expect, it, vi } from 'vitest';

const genAIConstructor = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() { genAIConstructor(); }
  },
}));

describe('getGenerativeModel feature gate', () => {
  beforeEach(() => {
    vi.resetModules();
    genAIConstructor.mockClear();
    process.env.APP_ENV = 'test';
    process.env.AI_IMPORT_ENABLED = 'false';
  });

  it('does not initialize Gemini when AI import is disabled', async () => {
    const { getGenerativeModel } = await import('./gemini');
    expect(() => getGenerativeModel()).toThrow('AI import is disabled');
    expect(genAIConstructor).not.toHaveBeenCalled();
  });
});
