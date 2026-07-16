-- Capacity checks may observe a different database size on every invocation.
-- Keep callers aligned with pg_database_size(), which PostgreSQL treats as
-- volatile, so schema linting does not assume a stale result can be reused.
ALTER FUNCTION private.database_capacity_status(bigint) VOLATILE;
ALTER FUNCTION private.enforce_database_capacity(text, bigint) VOLATILE;
ALTER FUNCTION public.get_database_capacity_status() VOLATILE;
