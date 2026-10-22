#!/usr/bin/env bash
# Run exactly one gated hosted cohort, then clean its synthetic accounts.
set -u
set -o pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root" || exit 1
cohort="${1:-}"
case "$cohort" in 10|50|100|150) ;; *) echo 'Choose 10, 50, 100 or 150 users.' >&2; exit 2 ;; esac
if [[ ! -t 0 ]]; then echo 'Run this in a private interactive terminal.' >&2; exit 2; fi
if [[ -n "${VISAFLOW_MULTIUSER_ADMIN_KEY:-}" ]]; then echo 'Unset the admin key before using this prompt.' >&2; exit 2; fi
if [[ ! -f .local/multiuser/limits.json ]]; then echo 'Fresh limits.json evidence is required.' >&2; exit 2; fi
if [[ -z "${VISAFLOW_MULTIUSER_PUBLIC_KEY:-}" ]]; then echo 'Set the exact dev publishable key first.' >&2; exit 2; fi

echo 'Running local Auth, Realtime and cleanup preflight before requesting a hosted credential.'
if ! bash tests/scale/operator-preflight.sh; then
  echo 'Local preflight failed. Hosted stage was not started and no dev secret was requested.' >&2
  exit 1
fi

IFS= read -r -s -p 'Paste the dev Supabase secret API key, then press Enter: ' admin_key
printf '\n'
if [[ ! "$admin_key" =~ ^sb_secret_[A-Za-z0-9_-]{20,}$ ]]; then echo 'Invalid dev secret key format.' >&2; exit 2; fi
export VISAFLOW_MULTIUSER_ENCRYPTION_KEY
VISAFLOW_MULTIUSER_ENCRYPTION_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
export VISAFLOW_MULTIUSER_ADMIN_KEY="$admin_key"

provision_output="$(node tests/scale/multiuser.mjs provision "$cohort")"
provision_status=$?
printf '%s\n' "$provision_output"
run_id="$(printf '%s\n' "$provision_output" | node -e 'let input="";process.stdin.on("data",c=>input+=c).on("end",()=>{try{let j=JSON.parse(input.trim().split("\n").at(-1));if(/^[0-9a-f-]{36}$/.test(j.runId))process.stdout.write(j.runId)}catch{}})')"
if [[ -z "$run_id" ]]; then echo 'No fixture was created; inspect the gate and dev settings.' >&2; exit 1; fi

run_status=1
if [[ $provision_status -eq 0 ]]; then
  unset VISAFLOW_MULTIUSER_ADMIN_KEY
  node tests/scale/multiuser.mjs run "$run_id"
  run_status=$?
  export VISAFLOW_MULTIUSER_ADMIN_KEY="$admin_key"
fi

node tests/scale/multiuser.mjs cleanup "$run_id"
cleanup_status=$?
unset VISAFLOW_MULTIUSER_ADMIN_KEY VISAFLOW_MULTIUSER_ENCRYPTION_KEY admin_key
if [[ $provision_status -eq 0 && $run_status -eq 0 && $cleanup_status -eq 0 ]]; then
  echo "Hosted stage $cohort passed and cleanup verified: $run_id"
else
  echo "Stage $cohort failed or cleanup needs attention: $run_id" >&2
  exit 1
fi
