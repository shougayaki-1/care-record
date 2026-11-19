-- Bound the initial batch row lock, before the existing per-shift confirmation
-- function applies its own lock timeout. PostgreSQL restores the caller's value
-- when this function returns.
alter function public.confirm_mcp_shift_update_batch(uuid,uuid[]) set lock_timeout = '5s';
