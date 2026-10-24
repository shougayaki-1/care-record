import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: true, user: vi.fn(), role: vi.fn(), audit: vi.fn(),
  model: vi.fn(), generate: vi.fn(), sanitize: vi.fn(),
}));
vi.mock('@/lib/env/server', () => ({ isAiImportEnabled: () => mocks.enabled }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.user, assertOrgRole: mocks.role }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: () => ({ message: 'safe fixture error' }) }));
vi.mock('@/lib/ai/gemini', () => ({ getGenerativeModel: mocks.model }));
vi.mock('@/utils/uploadSecurity', () => ({ sanitizeUploadedImage: mocks.sanitize }));
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.user.mockResolvedValue({ id: 'synthetic-actor', sessionId: 'synthetic-session' });
  mocks.role.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.model.mockReturnValue({ generateContent: mocks.generate });
  mocks.generate.mockResolvedValue({ response: { candidates: [{ content: { parts: [{ text: '{"records":[]}' }] } }] } });
});

function request(form = new FormData(), query = '?organizationId=synthetic-org') {
  return new NextRequest(`http://localhost/api/ai/extract${query}`, { method: 'POST', body: form });
}
function files() {
  const form = new FormData();
  form.append('files[]', new File(['synthetic PDF'], 'synthetic.pdf', { type: 'application/pdf' }));
  return form;
}

describe('AI extraction HTTP boundary', () => {
  it('returns 404 before authentication, body parsing or Vertex initialization when disabled', async () => {
    mocks.enabled = false;
    const req = request();
    const parse = vi.spyOn(req, 'formData');
    expect((await POST(req)).status).toBe(404);
    for (const fn of [parse, mocks.user, mocks.role, mocks.model, mocks.audit]) expect(fn).not.toHaveBeenCalled();
  });

  it('requires organization scope before authentication and parsing', async () => {
    const req = request(new FormData(), '');
    const parse = vi.spyOn(req, 'formData');
    expect((await POST(req)).status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it.each(['user', 'role'] as const)('rejects %s denial before parsing or contacting Vertex', async boundary => {
    mocks[boundary].mockRejectedValueOnce(new Error('synthetic private auth detail'));
    const req = request(files());
    const parse = vi.spyOn(req, 'formData');
    const response = await POST(req);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('private');
    for (const fn of [parse, mocks.model, mocks.audit]) expect(fn).not.toHaveBeenCalled();
  });

  it('rejects malformed multipart without creating the model', async () => {
    const req = request();
    vi.spyOn(req, 'formData').mockRejectedValueOnce(new Error('synthetic parser detail'));
    const response = await POST(req);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Bad Request: invalid form data');
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it('rejects missing files and malformed JSON before audit and Vertex', async () => {
    expect((await POST(request())).status).toBe(400);
    const form = files();
    form.set('clients', '{broken');
    expect((await POST(request(form))).status).toBe(400);
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('passes the authenticated actor and session to audit and completes an empty extraction', async () => {
    const response = await POST(request(files()));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toContain('data: {"type":"done","total":0}');
    expect(mocks.role).toHaveBeenCalledWith('synthetic-org');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'synthetic-actor', sessionId: 'synthetic-session', organizationId: 'synthetic-org', action: 'ai_import.started',
    }));
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0]);
  });

  it('redacts provider errors and continues later groups through completion', async () => {
    mocks.generate.mockRejectedValueOnce(new Error('synthetic private provider credential'));
    const form = files();
    form.append('files[]', new File(['another synthetic PDF'], 'second.pdf', { type: 'application/pdf' }));
    const text = await (await POST(request(form))).text();
    expect(text).toContain('event: error');
    expect(text).not.toContain('private provider');
    expect(text).toContain('event: group_done');
    expect(text).toContain('event: done');
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it('does not send an image to Vertex when image sanitization fails', async () => {
    mocks.sanitize.mockRejectedValueOnce(new Error('synthetic image decoder detail'));
    const form = new FormData();
    form.append('files[]', new File(['synthetic bytes'], 'image.png', { type: 'image/png' }));
    const text = await (await POST(request(form))).text();
    expect(text).toContain('event: error');
    expect(text).not.toContain('decoder detail');
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
