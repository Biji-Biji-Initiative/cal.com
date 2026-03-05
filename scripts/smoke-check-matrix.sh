#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_SCRIPT="$ROOT_DIR/scripts/smoke-check-calcom.sh"

PROD_URL="${PROD_URL:-}"
STAGING_URL="${STAGING_URL:-}"
DEV_URL="${DEV_URL:-}"
PROD_API_URL="${PROD_API_URL:-}"
STAGING_API_URL="${STAGING_API_URL:-}"
DEV_API_URL="${DEV_API_URL:-}"
TIMEOUT="${TIMEOUT:-20}"
CHECK_GOOGLE="true"
CHECK_SSO="true"
INSECURE="false"

usage() {
  cat <<'EOF'
Usage: scripts/smoke-check-matrix.sh [options]

Options:
  --prod-url <url>          Prod web URL
  --staging-url <url>       Staging web URL
  --dev-url <url>           Dev web URL
  --prod-api-url <url>      Optional prod API URL
  --staging-api-url <url>   Optional staging API URL
  --dev-api-url <url>       Optional dev API URL
  --timeout <sec>           Curl timeout (default: 20)
  --no-google               Skip Google login/callback checks
  --no-sso                  Skip Authentik outpost checks
  --insecure                Allow insecure TLS
  -h, --help                Show help

Environment variable alternatives:
  PROD_URL, STAGING_URL, DEV_URL
  PROD_API_URL, STAGING_API_URL, DEV_API_URL
  TIMEOUT
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod-url) PROD_URL="${2:-}"; shift 2 ;;
    --staging-url) STAGING_URL="${2:-}"; shift 2 ;;
    --dev-url) DEV_URL="${2:-}"; shift 2 ;;
    --prod-api-url) PROD_API_URL="${2:-}"; shift 2 ;;
    --staging-api-url) STAGING_API_URL="${2:-}"; shift 2 ;;
    --dev-api-url) DEV_API_URL="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --no-google) CHECK_GOOGLE="false"; shift ;;
    --no-sso) CHECK_SSO="false"; shift ;;
    --insecure) INSECURE="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[FAIL] Unknown option: $1"; usage; exit 1 ;;
  esac
done

[[ -x "$SMOKE_SCRIPT" ]] || { echo "[FAIL] Missing script: $SMOKE_SCRIPT"; exit 1; }

run_env() {
  local label="$1"
  local web="$2"
  local api="$3"
  local rc=0

  if [[ -z "$web" ]]; then
    echo "[INFO] Skipping $label (no URL provided)"
    return 0
  fi

  echo "[INFO] ===== $label ====="
  args=(--web-url "$web" --timeout "$TIMEOUT")
  if [[ -n "$api" ]]; then
    args+=(--api-url "$api")
  fi
  if [[ "$CHECK_GOOGLE" == "true" ]]; then
    args+=(--check-google)
  fi
  if [[ "$CHECK_SSO" == "true" ]]; then
    args+=(--check-sso)
  fi
  if [[ "$INSECURE" == "true" ]]; then
    args+=(--insecure)
  fi

  if ! "$SMOKE_SCRIPT" "${args[@]}"; then
    rc=1
  fi
  return "$rc"
}

failures=0
run_env "PROD" "$PROD_URL" "$PROD_API_URL" || failures=$((failures+1))
run_env "STAGING" "$STAGING_URL" "$STAGING_API_URL" || failures=$((failures+1))
run_env "DEV" "$DEV_URL" "$DEV_API_URL" || failures=$((failures+1))

if [[ "$failures" -gt 0 ]]; then
  echo "[FAIL] Smoke matrix failed in $failures environment(s)"
  exit 1
fi

echo "[PASS] Smoke matrix passed"
