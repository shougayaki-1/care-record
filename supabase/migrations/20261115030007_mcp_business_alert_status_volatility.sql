-- OAuth validation reads current connection state and is volatile. The status
-- RPC must not promise the planner that the result is stable within a query.
alter function public.get_mcp_business_alert_status(uuid) volatile;
