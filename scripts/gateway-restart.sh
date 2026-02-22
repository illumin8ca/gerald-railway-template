#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${OPENCLAW_WRAPPER_URL:-http://127.0.0.1:8080}"
SETUP_PASSWORD="${SETUP_PASSWORD:?Set SETUP_PASSWORD env var or pass via .env}"

printf 'Restarting gateway via %s/setup/api/gateway/restart ...\n' "${BASE_URL}"
curl -sS -X POST -u ":${SETUP_PASSWORD}" \
  "${BASE_URL}/setup/api/gateway/restart" \
  | cat
