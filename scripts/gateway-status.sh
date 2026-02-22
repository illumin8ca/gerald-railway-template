#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${OPENCLAW_WRAPPER_URL:-http://127.0.0.1:8080}"
SETUP_PASSWORD="${SETUP_PASSWORD:?Set SETUP_PASSWORD env var or pass via .env}"

echo "Checking gateway status via ${BASE_URL}/setup/api/gateway/status"
curl -sS -u ":${SETUP_PASSWORD}" \
  "${BASE_URL}/setup/api/gateway/status" \
  | cat
