#!/usr/bin/env bash

set -euo pipefail

WEB_URL=""
API_URL=""
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-15}"
INSECURE="false"
CHECK_GOOGLE="false"
CHECK_SSO="false"
ENABLE_DIAGNOSTICS="true"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/smoke-check-calcom.sh --web-url <url> [options]

Options:
  --web-url <url>       Required Cal.com web URL (e.g. https://calendar.example.com)
  --api-url <url>       Optional API v2 URL (e.g. https://api-v2.example.com)
  --timeout <seconds>   Curl timeout per check (default: 15)
  --check-google        Check Google login + callback routes
  --check-sso           Check Authentik outpost ping route
  --no-diagnostics      Disable DNS/TLS diagnostics on required-check failure
  --insecure            Allow insecure TLS certificates (curl -k)
  -h, --help            Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web-url)
      WEB_URL="${2:-}"
      shift 2
      ;;
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SECONDS="${2:-}"
      shift 2
      ;;
    --check-google)
      CHECK_GOOGLE="true"
      shift
      ;;
    --check-sso)
      CHECK_SSO="true"
      shift
      ;;
    --no-diagnostics)
      ENABLE_DIAGNOSTICS="false"
      shift
      ;;
    --insecure)
      INSECURE="true"
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

if [[ -z "$WEB_URL" ]]; then
  echo "--web-url is required." >&2
  usage
  exit 1
fi

if ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SECONDS" -lt 1 ]]; then
  echo "--timeout must be a positive integer." >&2
  exit 1
fi

curl_args=(-sS -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT_SECONDS")
if [[ "$INSECURE" == "true" ]]; then
  curl_args+=(-k)
fi

pass() { echo "[PASS] $1"; }
warn() { echo "[WARN] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }

normalize_url() {
  local raw="$1"
  echo "${raw%/}"
}

extract_host() {
  local url="$1"
  local without_scheme="${url#*://}"
  without_scheme="${without_scheme%%/*}"
  without_scheme="${without_scheme%%:*}"
  echo "$without_scheme"
}

run_diagnostics() {
  local label="$1"
  local url="$2"

  if [[ "$ENABLE_DIAGNOSTICS" != "true" ]]; then
    return 0
  fi

  local host
  host="$(extract_host "$url")"
  if [[ -z "$host" ]]; then
    return 0
  fi

  warn "$label diagnostics for host: $host"

  if command -v dig >/dev/null 2>&1; then
    local dig_result
    dig_result="$(dig +short A "$host" @1.1.1.1 | tr '\n' ' ' | xargs || true)"
    if [[ -n "$dig_result" ]]; then
      warn "$label DNS A @1.1.1.1 -> $dig_result"
    else
      warn "$label DNS A @1.1.1.1 -> <empty>"
    fi
  elif command -v getent >/dev/null 2>&1; then
    local getent_result
    getent_result="$(getent ahostsv4 "$host" | awk '{print $1}' | sort -u | tr '\n' ' ' | xargs || true)"
    if [[ -n "$getent_result" ]]; then
      warn "$label DNS (system resolver) -> $getent_result"
    else
      warn "$label DNS (system resolver) -> <empty>"
    fi
  fi

  if command -v openssl >/dev/null 2>&1; then
    local tls_probe
    tls_probe="$(echo | openssl s_client -brief -connect "${host}:443" -servername "$host" 2>&1 | head -n 4 | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | xargs || true)"
    if [[ -n "$tls_probe" ]]; then
      warn "$label TLS probe -> $tls_probe"
    fi
  fi
}

check_http() {
  local label="$1"
  local url="$2"
  local allowed="$3"
  local mode="${4:-required}" # required|warn

  local code
  if ! code="$(curl "${curl_args[@]}" "$url")"; then
    if [[ "$mode" == "warn" ]]; then
      warn "$label unreachable ($url)"
      return 0
    fi
    run_diagnostics "$label" "$url"
    fail "$label unreachable ($url)"
  fi

  local allowed_match="false"
  IFS=',' read -r -a statuses <<<"$allowed"
  for status in "${statuses[@]}"; do
    if [[ "$code" == "$status" ]]; then
      allowed_match="true"
      break
    fi
  done

  if [[ "$allowed_match" == "true" ]]; then
    pass "$label -> HTTP $code"
    return 0
  fi

  if [[ "$mode" == "warn" ]]; then
    warn "$label unexpected status HTTP $code (allowed: $allowed)"
    return 0
  fi

  run_diagnostics "$label" "$url"
  fail "$label unexpected status HTTP $code (allowed: $allowed)"
}

web="$(normalize_url "$WEB_URL")"

echo "[INFO] Smoke checks for web URL: $web"
check_http "Web root" "$web/" "200,301,302,307,308"
check_http "Web auth/login" "$web/auth/login" "200,301,302,307,308"
check_http "Web apps page (informational)" "$web/settings/apps" "200,301,302,307,308" warn

if [[ "$CHECK_GOOGLE" == "true" ]]; then
  check_http "Google auth signin" "$web/api/auth/signin/google" "200,301,302,307,308"
  check_http "Google Calendar callback route" "$web/api/integrations/googlecalendar/callback" "200,301,302,307,308,400,401"
fi

if [[ "$CHECK_SSO" == "true" ]]; then
  check_http "Authentik outpost ping" "$web/outpost.goauthentik.io/ping" "200,204"
fi

if [[ -n "$API_URL" ]]; then
  api="$(normalize_url "$API_URL")"
  echo "[INFO] Smoke checks for API URL: $api"
  check_http "API docs" "$api/docs" "200,301,302,307,308"
  check_http "API health (informational)" "$api/health" "200,204,301,302,307,308" warn
fi

pass "Smoke checks completed"
