type ToolName = 'check_record_quality' | 'propose_shift_change' | 'list_staff_availability' | 'list_approval_queue' | 'list_records' | 'get_record' | 'search_people' | 'list_workspaces' | 'get_record_form' | 'submit_record_candidate' | 'list_shifts' | 'get_shift';
type ObservationOptions = { now?: () => number; traceId?: () => string; emit?: (line: string) => void };

/** Operational counters only. Never serialize tool arguments, results or exceptions. */
export async function observeMcpTool<T>(tool: ToolName, operation: () => Promise<T>, options: ObservationOptions = {}): Promise<T> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const traceId = (options.traceId ?? (() => crypto.randomUUID()))();
  let outcome = 'error';
  try {
    const result = await operation();
    const object = result !== null && typeof result === 'object' ? result as Record<string, unknown> : {};
    const structured = object.structuredContent !== null && typeof object.structuredContent === 'object'
      ? object.structuredContent as Record<string, unknown> : {};
    outcome = object.isError === true ? 'error' : structured.status === 'needs_clarification' ? 'needs_clarification' : 'success';
    return result;
  } finally {
    const elapsed = now() - started;
    const event = {
      event: 'mcp.tool.completed', tool, outcome, trace_id: traceId,
      duration_ms: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0,
    };
    // Telemetry is separate from the atomic business audit. A log transport
    // failure must not turn an already committed candidate into a false failure.
    try { (options.emit ?? console.info)(JSON.stringify(event)); } catch { /* delivery is unverified */ }
  }
}
