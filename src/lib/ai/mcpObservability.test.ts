import { describe, expect, it, vi } from 'vitest';
import { observeMcpTool } from '../../../supabase/functions/_shared/mcp-observability';

describe('MCP operational observations', () => {
  it('records only fixed categories, monotonic duration and an unrelated trace identifier', async () => {
    const emit = vi.fn();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112.6);
    const result = { structuredContent: { candidate_id: 'private-candidate', organization_id: 'private-org',
      user_id: 'private-user', client_id: 'private-client', session_id: 'private-session', record: 'private-body' } };
    expect(await observeMcpTool('submit_record_candidate', async () => result,
      { now, emit, traceId: () => 'unrelated-random-id' })).toBe(result);
    expect(JSON.parse(emit.mock.calls[0][0])).toEqual({
      event: 'mcp.tool.completed', tool: 'submit_record_candidate', outcome: 'success',
      trace_id: 'unrelated-random-id', duration_ms: 13,
    });
    expect(emit.mock.calls.flat().join()).not.toContain('private-');
  });

  it('classifies thrown and returned tool errors without serializing error details', async () => {
    const emit = vi.fn();
    const error = Object.assign(new Error('private-message'), { name: 'private-name', stack: 'private-stack', token: 'private-token' });
    await expect(observeMcpTool('list_workspaces', async () => { throw error; }, { emit })).rejects.toBe(error);
    await observeMcpTool('get_record_form', async () => ({ isError: true, content: [{ text: 'private-content' }] }), { emit });
    expect(emit).toHaveBeenCalledTimes(2);
    for (const [line] of emit.mock.calls) {
      expect(JSON.parse(line).outcome).toBe('error');
      expect(line).not.toContain('private-');
      expect(JSON.parse(line).trace_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('counts clarification separately and keeps log transport failure separate from business results', async () => {
    const emit = vi.fn();
    await observeMcpTool('submit_record_candidate', async () => ({ structuredContent: { status: 'needs_clarification', questions: ['private-question'] } }), { emit });
    expect(JSON.parse(emit.mock.calls[0][0]).outcome).toBe('needs_clarification');
    expect(emit.mock.calls[0][0]).not.toContain('private-question');
    await expect(observeMcpTool('list_workspaces', async () => 'successful-result', {
      emit: () => { throw new Error('logging-failed'); },
    })).resolves.toBe('successful-result');
  });
});
