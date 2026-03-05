#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
READINESS_SCRIPT="$ROOT_DIR/scripts/check-rollout-readiness.sh"
SMOKE_SCRIPT="$ROOT_DIR/scripts/smoke-check-calcom.sh"

DEV_WEB_FILE="${DEV_WEB_FILE:-}"
STAGING_WEB_FILE="${STAGING_WEB_FILE:-}"
PROD_WEB_FILE="${PROD_WEB_FILE:-}"
API_V2_FILE="${API_V2_FILE:-}"
WEB_URL="${WEB_URL:-}"
API_URL="${API_URL:-}"

ALLOW_PLACEHOLDERS="false"
SKIP_GIT_CHECKS="false"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-20}"
INSECURE_SMOKE="false"
SMOKE_CHECK_GOOGLE="true"
SMOKE_CHECK_SSO="true"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/run-release-gate.sh [options]

Required env-file options:
  --dev-web <path>        Dev web env file
  --staging-web <path>    Staging web env file
  --prod-web <path>       Prod web env file
  --api-v2 <path>         API v2 env file

Optional live smoke options:
  --web-url <url>         Run smoke checks against web URL
  --api-url <url>         Optional API URL for smoke checks
  --smoke-timeout <sec>   Curl timeout for smoke checks (default: 20)
  --smoke-no-google       Skip Google login/callback smoke checks
  --smoke-no-sso          Skip Authentik outpost smoke checks
  --smoke-insecure        Allow insecure TLS for smoke checks

General options:
  --allow-placeholders    Allow placeholder values in env files (template mode)
  --skip-git-checks       Skip upstream/origin checks during readiness validation
  -h, --help              Show help

Environment variable alternatives:
  DEV_WEB_FILE, STAGING_WEB_FILE, PROD_WEB_FILE, API_V2_FILE, WEB_URL, API_URL
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev-web)
      DEV_WEB_FILE="${2:-}"
      shift 2
      ;;
    --staging-web)
      STAGING_WEB_FILE="${2:-}"
      shift 2
      ;;
    --prod-web)
      PROD_WEB_FILE="${2:-}"
      shift 2
      ;;
    --api-v2)
      API_V2_FILE="${2:-}"
      shift 2
      ;;
    --web-url)
      WEB_URL="${2:-}"
      shift 2
      ;;
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --smoke-timeout)
      SMOKE_TIMEOUT="${2:-}"
      shift 2
      ;;
    --smoke-no-google)
      SMOKE_CHECK_GOOGLE="false"
      shift
      ;;
    --smoke-no-sso)
      SMOKE_CHECK_SSO="false"
      shift
      ;;
    --smoke-insecure)
      INSECURE_SMOKE="true"
      shift
      ;;
    --allow-placeholders)
      ALLOW_PLACEHOLDERS="true"
      shift
      ;;
    --skip-git-checks)
      SKIP_GIT_CHECKS="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

[[ -x "$READINESS_SCRIPT" ]] || { echo "Missing script: $READINESS_SCRIPT" >&2; exit 1; }
[[ -x "$SMOKE_SCRIPT" ]] || { echo "Missing script: $SMOKE_SCRIPT" >&2; exit 1; }

if [[ -z "$DEV_WEB_FILE" || -z "$STAGING_WEB_FILE" || -z "$PROD_WEB_FILE" || -z "$API_V2_FILE" ]]; then
  echo "All env file paths are required." >&2
  usage
  exit 1
fi

echo "[INFO] Running rollout readiness checks"

readiness_args=(
  --dev-web "$DEV_WEB_FILE"
  --staging-web "$STAGING_WEB_FILE"
  --prod-web "$PROD_WEB_FILE"
  --api-v2 "$API_V2_FILE"
)

if [[ "$ALLOW_PLACEHOLDERS" == "true" ]]; then
  readiness_args+=(--allow-placeholders)
fi
if [[ "$SKIP_GIT_CHECKS" == "true" ]]; then
  readiness_args+=(--skip-git-checks)
fi

"$READINESS_SCRIPT" "${readiness_args[@]}"

if [[ -n "$WEB_URL" ]]; then
  echo "[INFO] Running live smoke checks"
  smoke_args=(--web-url "$WEB_URL" --timeout "$SMOKE_TIMEOUT")
  if [[ -n "$API_URL" ]]; then
    smoke_args+=(--api-url "$API_URL")
  fi
  if [[ "$SMOKE_CHECK_GOOGLE" == "true" ]]; then
    smoke_args+=(--check-google)
  fi
  if [[ "$SMOKE_CHECK_SSO" == "true" ]]; then
    smoke_args+=(--check-sso)
  fi
  if [[ "$INSECURE_SMOKE" == "true" ]]; then
    smoke_args+=(--insecure)
  fi
  "$SMOKE_SCRIPT" "${smoke_args[@]}"
else
  echo "[INFO] Skipping live smoke checks (no --web-url provided)"
fi

echo "[PASS] Release gate checks completed"
