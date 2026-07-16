import { beforeEach, describe, expect, it, vi } from 'vitest';

const vertexConstructor = vi.fn();

vi.mock('@google-cloud/vertexai', () => ({
  VertexAI: class {
    constructor() { vertexConstructor(); }
  },
}));

describe('getGenerativeModel feature gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vertexConstructor.mockClear();
    process.env.APP_ENV = 'test';
    process.env.AI_IMPORT_ENABLED = 'false';
  });

  it('does not initialize Vertex when AI import is disabled', async () => {
    const { getGenerativeModel } = await import('./gemini');
    expect(() => getGenerativeModel()).toThrow('AI import is disabled');
    expect(vertexConstructor).not.toHaveBeenCalled();
  });
});
