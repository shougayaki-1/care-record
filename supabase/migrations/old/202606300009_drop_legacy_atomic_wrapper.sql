-- Migration 006 created a 10-parameter wrapper alongside the 12-parameter
-- save_report_atomic function, causing PostgREST to return error 42883
-- (function not found) because it cannot resolve the overloaded name.
-- Drop the wrapper so only the 12-parameter version remains.
DROP FUNCTION IF EXISTS public.save_report_atomic(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text);
