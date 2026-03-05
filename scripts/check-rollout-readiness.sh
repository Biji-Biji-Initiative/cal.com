#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY_SCRIPT="$ROOT_DIR/scripts/verify-calcom-env.sh"

DEV_WEB_FILE="${DEV_WEB_FILE:-}"
STAGING_WEB_FILE="${STAGING_WEB_FILE:-}"
PROD_WEB_FILE="${PROD_WEB_FILE:-}"
API_V2_FILE="${API_V2_FILE:-}"

ALLOW_PLACEHOLDERS="false"
REQUIRE_GOOGLE="true"
REQUIRE_SSO="true"
SKIP_GIT_CHECKS="false"
SKIP_API_V2="false"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/check-rollout-readiness.sh [options]

Options:
  --dev-web <path>        Dev web env file
  --staging-web <path>    Staging web env file
  --prod-web <path>       Prod web env file
  --api-v2 <path>         API v2 env file
  --skip-api-v2           Skip API v2 env preflight checks
  --allow-placeholders    Allow template placeholders in env checks
  --no-google             Do not require Google login readiness checks
  --no-sso                Do not require SSO readiness checks
  --skip-git-checks       Skip upstream/origin/forbidden-file checks
  -h, --help              Show this help

Environment variable alternatives:
  DEV_WEB_FILE, STAGING_WEB_FILE, PROD_WEB_FILE, API_V2_FILE

Examples:
  scripts/check-rollout-readiness.sh \
    --dev-web ./calcom-k8s.env.example \
    --staging-web ./env-vars-production.example.yaml \
    --prod-web ./env-vars-production.example.yaml \
    --skip-api-v2 \
    --allow-placeholders

  scripts/check-rollout-readiness.sh \
    --dev-web /secure/dev-web.yaml \
    --staging-web /secure/staging-web.yaml \
    --prod-web /secure/prod-web.yaml \
    --api-v2 /secure/prod-api-v2.yaml
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
    --skip-api-v2)
      SKIP_API_V2="true"
      shift
      ;;
    --allow-placeholders)
      ALLOW_PLACEHOLDERS="true"
      shift
      ;;
    --no-google)
      REQUIRE_GOOGLE="false"
      shift
      ;;
    --no-sso)
      REQUIRE_SSO="false"
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

if [[ -z "$DEV_WEB_FILE" || -z "$STAGING_WEB_FILE" || -z "$PROD_WEB_FILE" ]]; then
  echo "Web env file arguments are required." >&2
  usage
  exit 1
fi
if [[ "$SKIP_API_V2" != "true" && -z "$API_V2_FILE" ]]; then
  echo "--api-v2 is required unless --skip-api-v2 is set." >&2
  usage
  exit 1
fi

if [[ ! -x "$VERIFY_SCRIPT" ]]; then
  echo "Missing verify script: $VERIFY_SCRIPT" >&2
  exit 1
fi

for candidate in "$DEV_WEB_FILE" "$STAGING_WEB_FILE" "$PROD_WEB_FILE"; do
  if [[ ! -f "$candidate" ]]; then
    echo "Env file not found: $candidate" >&2
    exit 1
  fi
done
if [[ "$SKIP_API_V2" != "true" ]]; then
  if [[ ! -f "$API_V2_FILE" ]]; then
    echo "Env file not found: $API_V2_FILE" >&2
    exit 1
  fi
fi

pass() { echo "[PASS] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }
info() { echo "[INFO] $1"; }

run_verify() {
  local label="$1"
  local file="$2"
  local profile="$3"
  shift 3
  local args=("$@")

  info "Checking $label ($profile): $file"
  if "$VERIFY_SCRIPT" "$file" --profile "$profile" "${args[@]}"; then
    pass "$label env preflight"
  else
    fail "$label env preflight"
  fi
}

if [[ "$SKIP_GIT_CHECKS" != "true" ]]; then
  info "Running git readiness checks"

  if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "Repository check"
  fi

  git -C "$ROOT_DIR" fetch upstream --prune >/dev/null 2>&1 || fail "git fetch upstream"
  git -C "$ROOT_DIR" fetch origin --prune >/dev/null 2>&1 || fail "git fetch origin"

  upstream_head="$(git -C "$ROOT_DIR" rev-parse upstream/main)"
  upstream_base="$(git -C "$ROOT_DIR" merge-base HEAD upstream/main)"
  if [[ "$upstream_head" != "$upstream_base" ]]; then
    fail "HEAD does not include latest upstream/main"
  fi
  pass "Includes latest upstream/main"

  origin_head="$(git -C "$ROOT_DIR" rev-parse origin/main)"
  local_head="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  if [[ "$origin_head" != "$local_head" ]]; then
    fail "HEAD is not aligned with origin/main (push/pull required)"
  fi
  pass "Aligned with origin/main"

  forbidden_tracked_files="$(git -C "$ROOT_DIR" ls-files | rg '(^|/)(calcom\.env|calcom-k8s\.env|env-vars-production\.yaml|env-vars-api-v2\.yaml|google-credentials\.json|\.deploy_api_v2.*\.log)$' || true)"
  if [[ -n "$forbidden_tracked_files" ]]; then
    echo "Forbidden tracked files detected:" >&2
    echo "$forbidden_tracked_files" >&2
    fail "Tracked secret-bearing file policy"
  fi
  pass "No forbidden tracked secret-bearing filenames"
fi

web_flags=()
api_flags=()
if [[ "$ALLOW_PLACEHOLDERS" == "true" ]]; then
  web_flags+=(--allow-placeholders)
  api_flags+=(--allow-placeholders)
fi
if [[ "$REQUIRE_GOOGLE" == "true" ]]; then
  web_flags+=(--require-google)
fi
if [[ "$REQUIRE_SSO" == "true" ]]; then
  web_flags+=(--require-sso)
fi

run_verify "dev-web" "$DEV_WEB_FILE" web "${web_flags[@]}"
run_verify "staging-web" "$STAGING_WEB_FILE" web "${web_flags[@]}"
run_verify "prod-web" "$PROD_WEB_FILE" web "${web_flags[@]}"
if [[ "$SKIP_API_V2" == "true" ]]; then
  info "Skipping api-v2 env preflight (--skip-api-v2)"
else
  run_verify "api-v2" "$API_V2_FILE" api-v2 "${api_flags[@]}"
fi

pass "Rollout readiness checks complete"
