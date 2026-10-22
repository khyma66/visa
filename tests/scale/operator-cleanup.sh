#!/usr/bin/env bash
# Reconcile only explicitly named, run-owned synthetic fixtures.
set -u
set -o pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root" || exit 1
if [[ ! -t 0 ]]; then echo 'Run this in a private interactive terminal.' >&2; exit 2; fi
if [[ -n "${VISAFLOW_MULTIUSER_ADMIN_KEY:-}" ]]; then echo 'Unset the admin key before using this prompt.' >&2; exit 2; fi
if [[ $# -lt 1 ]]; then echo 'Pass one or more run IDs.' >&2; exit 2; fi
for run_id in "$@"; do
  if [[ ! "$run_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ || ! -f ".local/multiuser/$run_id/manifest.json" ]]; then
    echo 'Every run ID must name a local test manifest.' >&2; exit 2
  fi
done

IFS= read -r -s -p 'Paste the dev Supabase secret API key, then press Enter: ' admin_key
printf '\n'
if [[ ! "$admin_key" =~ ^sb_secret_[A-Za-z0-9_-]{20,}$ ]]; then echo 'Invalid dev secret key format.' >&2; exit 2; fi
export VISAFLOW_MULTIUSER_ADMIN_KEY="$admin_key"
status=0
for run_id in "$@"; do
  node tests/scale/multiuser.mjs cleanup "$run_id" || status=1
done
unset VISAFLOW_MULTIUSER_ADMIN_KEY admin_key
exit "$status"
