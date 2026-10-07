#!/usr/bin/env bash
set -euo pipefail
umask 077

archive="${1:?usage: publish-backup-pair.sh ARCHIVE GS_URI}"
uri="${2:?GS_URI is required}"
[[ "$uri" == gs://*.tar.gz ]] || { echo "Invalid backup URI" >&2; exit 2; }
work_root="$(mktemp -d)"
trap 'rm -rf "$work_root"' EXIT
published_archive="$archive"

# Never replace a representative. If an earlier run uploaded only the body,
# recover its checksum from that body, not from this run's different dump.
if ! gcloud storage cp --quiet --if-generation-match=0 "$archive" "$uri" >/dev/null; then
  published_archive="$work_root/existing.tar.gz"
  gcloud storage cp --quiet "$uri" "$published_archive" >/dev/null
fi
hash="$(sha256sum "$published_archive" | cut -d' ' -f1)"
printf '%s  %s\n' "$hash" "$(basename "$uri")" > "$work_root/checksum"
if ! gcloud storage cp --quiet --if-generation-match=0 "$work_root/checksum" "${uri}.sha256" >/dev/null; then
  gcloud storage cp --quiet "${uri}.sha256" "$work_root/existing.sha256" >/dev/null
  cmp "$work_root/checksum" "$work_root/existing.sha256" >/dev/null || {
    echo "Existing backup checksum does not match; refusing to overwrite" >&2
    exit 1
  }
fi
printf '%s\n' "$hash"
