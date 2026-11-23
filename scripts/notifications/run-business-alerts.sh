#!/usr/bin/env bash
set -euo pipefail
: "${BUSINESS_ALERT_DATABASE_URL:?BUSINESS_ALERT_DATABASE_URL is required}"
: "${BUSINESS_ALERT_EXPECTED_HOST:?BUSINESS_ALERT_EXPECTED_HOST is required}"
: "${BUSINESS_ALERT_EXPECTED_USER:?BUSINESS_ALERT_EXPECTED_USER is required}"
# Require the environment-specific host, the dedicated login, and verified TLS.
# Values are never written to the log.
python3 - <<'PY'
import os, sys
from urllib.parse import urlsplit, parse_qs
u = urlsplit(os.environ['BUSINESS_ALERT_DATABASE_URL'])
q = parse_qs(u.query)
valid = (u.scheme in ('postgres', 'postgresql') and u.hostname == os.environ['BUSINESS_ALERT_EXPECTED_HOST']
         and u.username == os.environ['BUSINESS_ALERT_EXPECTED_USER'] and u.username.split('.')[0] not in ('postgres', 'service_role', 'supabase_admin', 'authenticator') and u.path == '/postgres'
         and q.get('sslmode') == ['verify-full'] and 'sslrootcert' not in q)
if not valid:
    print('Business alert database configuration does not match the expected environment.', file=sys.stderr)
    sys.exit(1)
PY
export PGCONNECT_TIMEOUT=10
count=$(psql "$BUSINESS_ALERT_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command 'SELECT public.run_mcp_business_alerts()')
[[ "$count" =~ ^[0-9]+$ ]] || { printf 'Unexpected business alert result.\n' >&2; exit 1; }
printf 'Business alert dispatch completed: %s notifications.\n' "$count"
