import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const stagingEndpoint = 'https://xhvvfovvlqzlkirpjocv.supabase.co/functions/v1/care-record-mcp';
const maximumResponseBytes = 1_000_000;
const toolNames = ['get_record', 'get_record_form', 'get_shift', 'list_approval_queue', 'list_records', 'list_shifts', 'list_staff_availability', 'list_workspaces', 'propose_shift_change', 'search_people', 'submit_record_candidate'];

export class McpContractError extends Error {
  constructor(code) { super(code); this.name = 'McpContractError'; }
}
const fail = code => { throw new McpContractError(code); };

export function validateToolContract(tools) {
  if (!Array.isArray(tools) || tools.length !== toolNames.length
    || tools.map(tool => tool?.name).sort().join(',') !== toolNames.join(',')) fail('tools_changed');
  for (const tool of tools) {
    if (tool.inputSchema?.type !== 'object') fail('input_schema_changed');
    if (tool.annotations?.readOnlyHint !== (tool.name !== 'submit_record_candidate')
      || tool.annotations?.destructiveHint !== false || tool.annotations?.openWorldHint !== false) fail('annotations_changed');
  }
  const availability = tools.find(tool => tool.name === 'list_staff_availability').inputSchema;
  for (const key of ['start_at', 'end_at']) {
    if (availability.properties?.[key]?.format !== 'date-time' || !availability.required?.includes(key)) fail('availability_input_changed');
  }
  const proposal = tools.find(tool => tool.name === 'propose_shift_change').inputSchema;
  for (const key of ['start_at', 'end_at']) {
    if (proposal.properties?.[key]?.format !== 'date-time' || !proposal.required?.includes(key)) fail('proposal_input_changed');
  }
  for (const key of ['shift_id', 'staff_id']) {
    if (proposal.properties?.[key]?.format !== 'uuid' || !proposal.required?.includes(key)) fail('proposal_input_changed');
  }
  const workspace = tools.find(tool => tool.name === 'list_workspaces').inputSchema;
  if (Object.keys(workspace.properties ?? {}).length) fail('workspace_inputs_changed');
  const form = tools.find(tool => tool.name === 'get_record_form').inputSchema;
  const submit = tools.find(tool => tool.name === 'submit_record_candidate').inputSchema;
  const list = tools.find(tool => tool.name === 'list_shifts').inputSchema;
  const detail = tools.find(tool => tool.name === 'get_shift').inputSchema;
  const queue = tools.find(tool => tool.name === 'list_approval_queue').inputSchema;
  const records = tools.find(tool => tool.name === 'list_records').inputSchema;
  const record = tools.find(tool => tool.name === 'get_record').inputSchema;
  const people = tools.find(tool => tool.name === 'search_people').inputSchema;
  for (const schema of [form, submit, list, detail, people, records, record, queue, availability, proposal]) {
    if (schema.properties?.organization_id?.type !== 'string'
      || schema.properties.organization_id.format !== 'uuid'
      || !schema.required?.includes('organization_id')) fail('organization_input_changed');
  }
  if (people.properties?.name?.type !== 'string' || !people.required?.includes('name')
    || !people.required?.includes('kind') || people.properties?.kind?.enum?.join(',') !== 'client,staff') fail('person_search_input_changed');
  for (const key of ['start_date', 'end_date']) {
    if (list.properties?.[key]?.format !== 'date' || !list.required?.includes(key)) fail('shift_date_input_changed');
  }
  for (const key of ['start_date', 'end_date']) {
    if (queue.properties?.[key]?.format !== 'date' || !queue.required?.includes(key)) fail('queue_date_input_changed');
    if (records.properties?.[key]?.format !== 'date' || !records.required?.includes(key)) fail('record_date_input_changed');
  }
  if (record.properties?.record_id?.format !== 'uuid' || !record.required?.includes('record_id')) fail('record_id_input_changed');
  if (detail.properties?.shift_id?.format !== 'uuid' || !detail.required?.includes('shift_id')) fail('shift_id_input_changed');
  if (submit.properties?.send_anyway?.type !== 'boolean'
    || submit.properties.send_anyway.default !== false
    || submit.required?.includes('send_anyway')) fail('send_anyway_changed');
  if (submit.properties?.record?.type !== 'object' || !submit.required?.includes('record')) fail('record_input_changed');
  if (submit.properties?.source_file_name?.type !== 'string'
    || submit.properties.source_file_name.maxLength !== 255) fail('source_file_input_changed');
}

async function readResponse(response, id) {
  if (!response.ok) fail(response.status === 401 ? 'authentication_required' : 'http_failure');
  if (!response.body) fail('missing_response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = ''; let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maximumResponseBytes) fail('response_too_large');
      text += decoder.decode(item.value, { stream: true });
      // SSE servers may keep the stream open; stop after the matching response.
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const messages = text.replace(/\r\n/g, '\n').split('\n\n');
        for (const message of messages.slice(0, -1)) {
          const data = message.split('\n').filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { fail('invalid_response'); }
          if (parsed.id === id) return parsed;
        }
      }
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { fail('invalid_response'); }
  } finally { await reader.cancel().catch(() => {}); }
}

/** Metadata only: never calls a tool or sends record content. */
export async function checkMcpContract({ endpoint = stagingEndpoint, token, fetchImpl = fetch }) {
  if (endpoint !== stagingEndpoint) fail('staging_endpoint_required');
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) fail('token_required');
  let session; let protocol;
  const request = async (method, params, id) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session } : {}),
        ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method, ...(id ? { id } : {}), ...(params ? { params } : {}) }),
    }).catch(() => fail('transport_failure'));
    if (!id) { await response.body?.cancel(); if (!response.ok) fail('http_failure'); return; }
    const message = await readResponse(response, id);
    if (message.jsonrpc !== '2.0' || message.id !== id || message.error || !message.result) fail('protocol_failure');
    session = response.headers.get('mcp-session-id') ?? session;
    return message.result;
  };
  const initialized = await request('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'care-record-contract-check', version: '1.0.0' },
  }, 1);
  if (typeof initialized.protocolVersion !== 'string' || !initialized.capabilities?.tools) fail('initialization_changed');
  protocol = initialized.protocolVersion;
  await request('notifications/initialized');
  const result = await request('tools/list', {}, 2);
  if (result.nextCursor) fail('tools_pagination_changed');
  validateToolContract(result.tools);
  return { status: 'passed', checked: 'initialize/tools/list', toolCount: result.tools.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Never include response bodies, tokens, URL queries, SDK errors, or stack traces.
  checkMcpContract({ token: process.env.MCP_STAGING_ACCESS_TOKEN }).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    const code = error instanceof McpContractError ? error.message : 'check_failed';
    process.stderr.write(`MCP contract: ${code}\n`); process.exitCode = 1;
  });
}
