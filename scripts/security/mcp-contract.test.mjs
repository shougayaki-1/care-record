import assert from 'node:assert/strict';
import test from 'node:test';
import { checkMcpContract, validateToolContract } from './check-mcp-contract.mjs';

const endpoint = 'https://xhvvfovvlqzlkirpjocv.supabase.co/functions/v1/care-record-mcp';
const token = 'synthetic-token';
function contract() {
  const organization = { type: 'string', format: 'uuid' };
  return ['list_workspaces', 'get_record_form', 'submit_record_candidate', 'list_shifts', 'get_shift'].map(name => ({
    name, annotations: { readOnlyHint: name !== 'submit_record_candidate', openWorldHint: false, destructiveHint: false },
    inputSchema: name === 'list_workspaces' ? { type: 'object', properties: {} } : {
      type: 'object', required: name === 'get_record_form' ? ['organization_id'] : name === 'list_shifts' ? ['organization_id', 'start_date', 'end_date'] : name === 'get_shift' ? ['organization_id', 'shift_id'] : ['organization_id', 'record'],
      properties: { organization_id: organization, ...(name === 'list_shifts' ? { start_date: { type: 'string', format: 'date' }, end_date: { type: 'string', format: 'date' } } : {}), ...(name === 'get_shift' ? { shift_id: organization } : {}), ...(name === 'submit_record_candidate' ? {
        record: { type: 'object' }, send_anyway: { type: 'boolean', default: false },
        source_file_name: { type: 'string', maxLength: 255 },
      } : {}) },
    },
  }));
}
function fakeServer({ sse = false, mutate = tools => tools } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    const call = JSON.parse(options.body); calls.push(call);
    if (call.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = call.method === 'initialize'
      ? { protocolVersion: '2025-11-25', capabilities: { tools: {} } }
      : { tools: mutate(contract()) };
    if (call.method === 'tools/list') {
      assert.equal(options.headers['Mcp-Session-Id'], 'synthetic-session');
      assert.equal(options.headers['MCP-Protocol-Version'], '2025-11-25');
    }
    const message = JSON.stringify({ jsonrpc: '2.0', id: call.id, result });
    return new Response(sse ? `event: message\r\ndata: ${message}\r\n\r\n` : message, {
      headers: { 'content-type': sse ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'synthetic-session' },
    });
  };
  return { fetchImpl, calls };
}

test('checks JSON and SSE metadata contracts without calling business tools', async () => {
  for (const sse of [false, true]) {
    const server = fakeServer({ sse });
    assert.deepEqual(await checkMcpContract({ token, fetchImpl: server.fetchImpl }), {
      status: 'passed', checked: 'initialize/tools/list', toolCount: 5,
    });
    assert.deepEqual(server.calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/list']);
  }
});

test('rejects wrong environments and missing credentials before any request', async () => {
  const fetchImpl = () => assert.fail('network must not be called');
  await assert.rejects(checkMcpContract({ endpoint: 'https://production.invalid', token, fetchImpl }), /staging_endpoint_required/);
  await assert.rejects(checkMcpContract({ token: '', fetchImpl }), /token_required/);
});

test('catches stale send_anyway and privilege-hint changes', () => {
  const stale = contract(); delete stale[2].inputSchema.properties.send_anyway;
  assert.throws(() => validateToolContract(stale), /send_anyway_changed/);
  const misleading = contract(); misleading[2].annotations.readOnlyHint = true;
  assert.throws(() => validateToolContract(misleading), /annotations_changed/);
  assert.throws(() => validateToolContract(contract().slice(0, 2)), /tools_changed/);
});

test('treats HTTP and JSON-RPC failures as failures without leaking response details', async () => {
  for (const [response, code] of [
    [new Response('private-provider-details', { status: 401 }), 'authentication_required'],
    [Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'private-provider-details' } }), 'protocol_failure'],
    [new Response('private-provider-details'), 'invalid_response'],
  ]) {
    await assert.rejects(checkMcpContract({ token, fetchImpl: async () => response }), error => error.message === code);
  }
  await assert.rejects(checkMcpContract({ token, fetchImpl: async () => { throw new Error('private-provider-details'); } }),
    error => error.message === 'transport_failure');
});

test('bounds provider response size', async () => {
  await assert.rejects(checkMcpContract({ token, fetchImpl: async () => new Response('x'.repeat(1_000_001)) }), /response_too_large/);
});

test('cancels an open SSE stream after receiving the matching metadata response', async () => {
  let cancelled = 0;
  const server = fakeServer();
  const fetchImpl = async (url, options) => {
    const response = await server.fetchImpl(url, options);
    if (!response.body) return response;
    const message = await response.text();
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${message}\n\n`)); },
      cancel() { cancelled++; },
    }), { headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'synthetic-session' } });
  };
  await checkMcpContract({ token, fetchImpl });
  assert.equal(cancelled, 2);
});
