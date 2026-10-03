import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  enabled: true, provider: 'openai' as 'openai' | 'gemini',
  user: vi.fn(), role: vi.fn(), audit: vi.fn(), log: vi.fn(),
  openai: vi.fn(), gemini: vi.fn(), model: vi.fn(),
}));
vi.mock('@/lib/env/server', () => ({ isAiImportEnabled: () => mocks.enabled, getAiExtractProvider: () => mocks.provider }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.user, assertOrgRole: mocks.role }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/log', () => ({ logError: mocks.log, serializeError: (error: unknown) => error }));
vi.mock('@/lib/ai/openai', () => ({ generateOpenAIExtractionText: mocks.openai }));
vi.mock('@/lib/ai/gemini', () => ({ getGenerativeModel: mocks.model }));
vi.mock('@/utils/uploadSecurity', () => ({ sanitizeUploadedImage: vi.fn() }));
import { POST } from './route';

const result = { records: [{
  meta: { date: null, start_at: null, end_at: null, client_name: 'テスト', helper_names: [], client_id_candidate: 'other-tenant', helper_id_candidates: [] },
  values: { amount: null, choice: 'not-an-option', secret: 'unknown-field' }, confidence: 'high', warnings: [],
}] };
function request() {
  const data = new FormData();
  data.append('files[]', new File(['%PDF-test'], 'record.pdf', { type: 'application/pdf' }));
  data.set('formTemplate', JSON.stringify([
    { id: 'amount', type: 'number', label: '数量', required: true },
    { id: 'choice', type: 'select', label: '選択', options: 'あり,なし', required: false },
  ]));
  data.set('clients', JSON.stringify([{ id: 'client-1', name: 'テスト' }]));
  return new NextRequest('http://localhost/api/ai/extract?organizationId=org-1', { method: 'POST', body: data });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled = true; mocks.provider = 'openai';
  mocks.user.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
  mocks.openai.mockResolvedValue(JSON.stringify(result));
  mocks.gemini.mockResolvedValue({ text: JSON.stringify(result) });
  mocks.model.mockReturnValue({ generateContent: mocks.gemini });
});

describe('AI extraction provider boundary', () => {
  it('checks the feature flag before authentication or AI initialization', async () => {
    mocks.enabled = false;
    expect((await POST(request())).status).toBe(404);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.openai).not.toHaveBeenCalled();
  });
  it('rejects a user without organization access before sending files', async () => {
    mocks.role.mockRejectedValue(new Error('access denied'));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.openai).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it('normalizes OpenAI output and audits the selected provider', async () => {
    const body = await (await POST(request())).text();
    const event = JSON.parse(body.split('\n').find(line => line.startsWith('data: '))!.slice(6));
    expect(event.result.values).toEqual({});
    expect(event.result.meta.client_id_candidate).toBeNull();
    expect(event.result.meta.date).toBeNull();
    expect(event.result.warnings).toContain('数量: 必須項目を確認してください');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ provider: 'openai' }) }));
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it('does not send files to Gemini when OpenAI fails', async () => {
    mocks.openai.mockRejectedValue(new Error('private provider diagnostic'));
    const body = await (await POST(request())).text();
    expect(body).toContain('event: error');
    expect(body).not.toContain('private provider diagnostic');
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it('uses a concrete form schema and the same normalization for Gemini', async () => {
    mocks.provider = 'gemini';
    const body = await (await POST(request())).text();
    expect(body).toContain('event: record');
    expect(mocks.gemini).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ responseSchema: expect.objectContaining({ type: 'OBJECT' }) }) }));
    expect(mocks.openai).not.toHaveBeenCalled();
  });
});
