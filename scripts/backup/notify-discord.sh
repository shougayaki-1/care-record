#!/usr/bin/env bash
set -euo pipefail

: "${DISCORD_ALERT_WEBHOOK_URL:?DISCORD_ALERT_WEBHOOK_URL is required}"
: "${APP_ENV:?APP_ENV is required}"

severity="${1:-Critical}"
check="${2:-backup_failed}"
evidence_url="${3:-unavailable}"

case "$severity" in Critical|High|Warning|Info) ;; *) severity="Critical" ;; esac
case "$check" in *[!A-Za-z0-9_.:-]*|'') check="invalid_check_name" ;; esac
case "$APP_ENV" in production|staging) ;; *) APP_ENV="unknown" ;; esac

payload="$(jq -n \
  --arg environment "$APP_ENV" \
  --arg severity "$severity" \
  --arg check "$check" \
  --arg detected_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg evidence_url "$evidence_url" \
  '{content: ("[CareRecord] " + $severity + " / " + $check), embeds: [{fields: [
    {name: "Environment", value: $environment, inline: true},
    {name: "Severity", value: $severity, inline: true},
    {name: "Check", value: $check, inline: false},
    {name: "Detected at", value: $detected_at, inline: false},
    {name: "Evidence", value: $evidence_url, inline: false}
  ]}]}'
)"

curl --fail --silent --show-error \
  --header 'Content-Type: application/json' \
  --data "$payload" \
  "$DISCORD_ALERT_WEBHOOK_URL" >/dev/null
