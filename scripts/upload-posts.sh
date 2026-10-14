#!/bin/bash

echo "Retired legacy upload: no action taken. Review ingestion against a disposable staging target; see docs/ENVIRONMENT_ISOLATION.md. Do not seed production." >&2
exit 1

# Historical implementation retained below for reference only. Do not re-enable.

echo "📤 Uploading seed data..."

# Upload to R2
wrangler r2 object put data-pipeline/seed-posts.json --file scripts/seed-data.json

# Trigger processing
WORKER_URL="https://visa-1.YOUR_SUBDOMAIN.workers.dev"
curl -X GET "$WORKER_URL/run"

echo "✅ Data uploaded and queued!"
