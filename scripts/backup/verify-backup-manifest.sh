#!/usr/bin/env bash
set -euo pipefail

backup_dir="${1:?usage: verify-backup-manifest.sh EXTRACTED_BACKUP_DIRECTORY}"
manifest="$backup_dir/manifest.sha256"

test -f "$manifest" || { echo "manifest.sha256 is missing" >&2; exit 1; }

while IFS= read -r line; do
  file="${line#*  }"
  case "$file" in
    ''|/*|*'..'*|*\\*) echo "unsafe manifest path: $file" >&2; exit 1 ;;
  esac
done < "$manifest"

(cd "$backup_dir" && sha256sum --check --strict manifest.sha256)
