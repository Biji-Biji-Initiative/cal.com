#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${SERVICE_NAME:-calcom-app-prod}"
REGION="${REGION:-us-central1}"
PROJECT_ID="${PROJECT_ID:-}"

info() {
  echo "[INFO] $1"
}

fail() {
  echo "[ERROR] $1" >&2
  exit 1
}

prompt_input() {
  local prompt="$1"
  local var_name="$2"
  local secret="${3:-false}"
  local value=""

  if [[ "$secret" == "true" ]]; then
    read -r -s -p "$prompt: " value
    echo
  else
    read -r -p "$prompt: " value
  fi
  printf -v "$var_name" '%s' "$value"
}

yaml_single_quote() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

if [[ ! -f "$REPO_ROOT/package.json" ]]; then
  fail "Run this script from the cal.com repository root."
fi

command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI is required."

info "Cal.com integration env updater"
info "Target service: ${SERVICE_NAME} (${REGION})"
echo

prompt_input "Google OAuth credentials file path (downloaded JSON)" GOOGLE_CREDENTIALS_FILE
[[ -f "$GOOGLE_CREDENTIALS_FILE" ]] || fail "Google credentials file not found: $GOOGLE_CREDENTIALS_FILE"

ZOOM_CLIENT_ID=""
ZOOM_CLIENT_SECRET=""
prompt_input "Zoom Client ID (optional)" ZOOM_CLIENT_ID
prompt_input "Zoom Client Secret (optional)" ZOOM_CLIENT_SECRET true

if [[ -n "$ZOOM_CLIENT_ID" && -z "$ZOOM_CLIENT_SECRET" ]]; then
  fail "Zoom Client Secret is required when Zoom Client ID is set."
fi
if [[ -z "$ZOOM_CLIENT_ID" && -n "$ZOOM_CLIENT_SECRET" ]]; then
  fail "Zoom Client ID is required when Zoom Client Secret is set."
fi

if command -v jq >/dev/null 2>&1; then
  GOOGLE_API_CREDENTIALS="$(jq -c . "$GOOGLE_CREDENTIALS_FILE")"
  client_id="$(jq -r '.web.client_id // empty' "$GOOGLE_CREDENTIALS_FILE")"
  client_secret="$(jq -r '.web.client_secret // empty' "$GOOGLE_CREDENTIALS_FILE")"
  redirect_count="$(jq -r '(.web.redirect_uris // []) | length' "$GOOGLE_CREDENTIALS_FILE")"
  [[ -n "$client_id" && -n "$client_secret" && "$redirect_count" -gt 0 ]] || fail "Google credentials JSON is missing web.client_id, web.client_secret, or web.redirect_uris."
else
  GOOGLE_API_CREDENTIALS="$(tr -d '\n' <"$GOOGLE_CREDENTIALS_FILE")"
  [[ "$GOOGLE_API_CREDENTIALS" == *"client_id"* && "$GOOGLE_API_CREDENTIALS" == *"client_secret"* ]] || fail "Google credentials JSON does not appear valid. Install jq for strict validation."
fi

tmp_env="$(mktemp "${TMPDIR:-/tmp}/calcom-integrations.XXXXXX.yaml")"
trap 'rm -f "$tmp_env"' EXIT

{
  printf 'GOOGLE_LOGIN_ENABLED: "true"\n'
  printf 'GOOGLE_API_CREDENTIALS: %s\n' "$(yaml_single_quote "$GOOGLE_API_CREDENTIALS")"
  if [[ -n "$ZOOM_CLIENT_ID" ]]; then
    printf 'ZOOM_CLIENT_ID: "%s"\n' "$ZOOM_CLIENT_ID"
    printf 'ZOOM_CLIENT_SECRET: "%s"\n' "$ZOOM_CLIENT_SECRET"
  fi
} >"$tmp_env"

args=(run services update "$SERVICE_NAME" --region "$REGION" --env-vars-file "$tmp_env" --quiet)
if [[ -n "$PROJECT_ID" ]]; then
  args+=(--project "$PROJECT_ID")
fi

info "Updating Cloud Run environment variables..."
gcloud "${args[@]}"

info "Integration variables updated successfully."
info "Next steps:"
info "1. Verify Google login and Google Calendar install flow in /settings/apps."
info "2. If needed, reseed app store: yarn workspace @calcom/prisma db-seed"
