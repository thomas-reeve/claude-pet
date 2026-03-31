#!/bin/bash
# Claude Pet status updater
# Usage: claude-status.sh <state> [task] [tokens] [resetsAt]
#   state:    working | idle | sleeping | rate_limited
#   task:     description of what's happening (optional)
#   tokens:   approximate token count (optional)
#   resetsAt: ISO timestamp for rate_limited state (optional)

set -euo pipefail

PET_URL="http://localhost:3950/status"

STATE="${1:?Usage: claude-status.sh <state> [task] [tokens] [resetsAt]}"
TASK="${2:-}"
TOKENS="${3:-0}"
RESETS_AT="${4:-}"

# Build JSON payload
JSON=$(cat <<EOF
{
  "state": "${STATE}",
  "task": "${TASK}",
  "tokens": ${TOKENS}
EOF
)

if [ -n "$RESETS_AT" ]; then
  JSON="${JSON}, \"resetsAt\": \"${RESETS_AT}\""
fi

JSON="${JSON} }"

curl -s -X POST "$PET_URL" \
  -H "Content-Type: application/json" \
  -d "$JSON" \
  --connect-timeout 2 \
  --max-time 5 || true
