import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOpenAIInput, generateOpenAIExtractionText } from './openai';

const createResponse = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class {
    responses = { create: createResponse };
  },
}));

describe('OpenAI extraction', () => {
  beforeEach(() => {
    createResponse.mockReset();
    vi.stubEnv('OPENAI_API_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sends PDFs as high-detail files and photos as images', () => {
    const input = buildOpenAIInput('読み取り', [
      { name: 'test.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') },
      { name: 'photo.png', mimeType: 'image/png', data: Buffer.from('image') },
    ]);
    expect(input[0]).toEqual({ type: 'input_text', text: '読み取り' });
    expect(input[1]).toMatchObject({ type: 'input_file', filename: 'test.pdf', detail: 'high', file_data: 'data:application/pdf;base64,cGRm' });
    expect(input[2]).toMatchObject({ type: 'input_image', detail: 'high', image_url: 'data:image/png;base64,aW1hZ2U=' });
  });

  it('refuses to call the API without a key', async () => {
    await expect(generateOpenAIExtractionText({ systemPrompt: 'system', userPrompt: 'user', files: [], formTemplate: [] }))
      .rejects.toThrow('OpenAI APIキー');
    expect(createResponse).not.toHaveBeenCalled();
  });

  it('uses strict structured output and does not store the response', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key');
    createResponse.mockResolvedValue({ status: 'completed', output_text: '{"records":[]}' });
    const output = await generateOpenAIExtractionText({ systemPrompt: 'system', userPrompt: 'user', files: [], formTemplate: [] });
    expect(output).toBe('{"records":[]}');
    expect(createResponse).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-6-luna', instructions: 'system', store: false,
      text: { format: expect.objectContaining({ type: 'json_schema', strict: true }) },
    }));
  });

  it('rejects incomplete responses', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key');
    createResponse.mockResolvedValue({ status: 'incomplete', output_text: '{"records":[]}' });
    await expect(generateOpenAIExtractionText({ systemPrompt: 'system', userPrompt: 'user', files: [], formTemplate: [] }))
      .rejects.toThrow('AI の応答形式');
  });
});
