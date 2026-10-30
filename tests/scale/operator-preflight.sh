#!/usr/bin/env bash
# Disposable local Auth, PostgREST and Realtime protocol check. No hosted credentials.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
workdir='.local/supabase-protocol'
cohort="${1:-4}"
case "$cohort" in 4|10|50|100|150) ;; *) echo 'Choose 4, 10, 50, 100 or 150 local users.' >&2; exit 2 ;; esac
if [[ -x /opt/homebrew/bin/supabase ]]; then
  cli=/opt/homebrew/bin/supabase
else
  cli="$(command -v supabase)"
fi
export VISAFLOW_LOCAL_SUPABASE_CLI="$cli"
mkdir -p "$workdir/supabase/migrations"
cat > "$workdir/supabase/config.toml" <<'EOF'
[auth]
enabled = true
site_url = "http://localhost:3000"
jwt_expiry = 3600
enable_signup = true

[api]
port = 55431

[db]
port = 55432
shadow_port = 55430

[studio]
enabled = false

[storage]
enabled = false
EOF
for migration in \
  20260904032053_community_core.sql \
  20260907191603_secure_community_views.sql \
  20260910031322_realtime_discovery_and_message_requests.sql \
  20260910034701_production_access_hardening.sql \
  20260910035131_imported_comment_discovery.sql \
  20260910055528_launch_safety_and_moderation.sql \
  20260911050812_community_write_guard_gaps.sql \
  20261003175714_messaging_delivery_reliability.sql \
  20261003180348_secure_native_vote_rpcs.sql \
  20261004221850_policy_acceptance_receipts.sql \
  20261006042952_public_avatar_initials.sql \
  20261006043113_avatar_name_policy_v2.sql; do
  cp "supabase/migrations/$migration" "$workdir/supabase/migrations/$migration"
done
"$cli" start --workdir "$workdir" -x studio,postgres-meta,mailpit,imgproxy,storage-api,edge-runtime,logflare,vector,supavisor >/dev/null
trap '"$cli" stop --workdir "$workdir" >/dev/null' EXIT
if [[ "${VISAFLOW_LOCAL_RUNNER_PROTOCOL:-0}" == 1 ]]; then
  node workers/community-runner/local-protocol.mjs
else
  node tests/scale/local-protocol-smoke.mjs "$cohort"
fi
