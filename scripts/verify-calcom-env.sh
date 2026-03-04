#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <env-file> [--profile web|api-v2] [--allow-placeholders] [--require-google] [--require-sso]" >&2
  exit 1
fi

ENV_FILE="$1"
ALLOW_PLACEHOLDERS="false"
PROFILE="web"
REQUIRE_GOOGLE="false"
REQUIRE_SSO="false"

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-placeholders)
      ALLOW_PLACEHOLDERS="true"
      ;;
    --profile)
      PROFILE="${2:-}"
      shift
      ;;
    --require-google)
      REQUIRE_GOOGLE="true"
      ;;
    --require-sso)
      REQUIRE_SSO="true"
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if [[ "$PROFILE" != "web" && "$PROFILE" != "api-v2" ]]; then
  echo "Invalid profile: $PROFILE (expected web or api-v2)" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

required_keys=()
if [[ "$PROFILE" == "web" ]]; then
  required_keys=(
    NEXTAUTH_URL
    NEXT_PUBLIC_WEBAPP_URL
    WEB_APP_URL
    NEXTAUTH_SECRET
    CALENDSO_ENCRYPTION_KEY
    DATABASE_URL
    DATABASE_DIRECT_URL
    GOOGLE_LOGIN_ENABLED
    GOOGLE_API_CREDENTIALS
    CALCOM_LICENSE_KEY
    CAL_SIGNATURE_TOKEN
  )
else
  required_keys=(
    API_URL
    WEB_APP_URL
    NEXTAUTH_SECRET
    CALENDSO_ENCRYPTION_KEY
    DATABASE_READ_URL
    DATABASE_WRITE_URL
    DATABASE_URL
    DATABASE_DIRECT_URL
    CALCOM_LICENSE_KEY
    CAL_SIGNATURE_TOKEN
    REDIS_URL
  )
fi

optional_keys=(
  NEXT_PUBLIC_IS_E2E
  REDIS_URL
)

extract_value() {
  local key="$1"
  local line
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*[:=]" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi

  local value="$line"
  if [[ "$line" == *"="* ]]; then
    value="${line#*=}"
  else
    value="${line#*:}"
  fi

  value="$(echo "$value" | sed -E "s/^[[:space:]]+//; s/[[:space:]]+$//; s/^'(.*)'$/\1/; s/^\"(.*)\"$/\1/")"
  echo "$value"
}

has_placeholder() {
  local value="$1"
  [[ "$value" == *"REPLACE_WITH_"* || "$value" == *"<set-in-infisical>"* || "$value" == *"your-"* ]]
}

missing=()
placeholder=()
invalid=()

for key in "${required_keys[@]}"; do
  value="$(extract_value "$key")"
  if [[ -z "$value" ]]; then
    missing+=("$key")
    continue
  fi

  if [[ "$ALLOW_PLACEHOLDERS" != "true" ]] && has_placeholder "$value"; then
    placeholder+=("$key")
  fi
done

nextauth_url="$(extract_value "NEXTAUTH_URL")"
if [[ -n "$nextauth_url" && ! "$nextauth_url" =~ ^https?:// ]]; then
  invalid+=("NEXTAUTH_URL (must start with http:// or https://)")
fi

web_app_url="$(extract_value "WEB_APP_URL")"
if [[ -n "$web_app_url" && ! "$web_app_url" =~ ^https?:// ]]; then
  invalid+=("WEB_APP_URL (must start with http:// or https://)")
fi

next_public_webapp_url="$(extract_value "NEXT_PUBLIC_WEBAPP_URL")"
if [[ -n "$next_public_webapp_url" && ! "$next_public_webapp_url" =~ ^https?:// ]]; then
  invalid+=("NEXT_PUBLIC_WEBAPP_URL (must start with http:// or https://)")
fi

api_url="$(extract_value "API_URL")"
if [[ -n "$api_url" && ! "$api_url" =~ ^https?:// ]]; then
  invalid+=("API_URL (must start with http:// or https://)")
fi

next_public_is_e2e="$(extract_value "NEXT_PUBLIC_IS_E2E")"
if [[ "$next_public_is_e2e" == "1" || "$next_public_is_e2e" == "true" ]]; then
  invalid+=("NEXT_PUBLIC_IS_E2E (must be false/0 outside automated E2E)")
fi

google_login_enabled="$(extract_value "GOOGLE_LOGIN_ENABLED")"
google_api_credentials="$(extract_value "GOOGLE_API_CREDENTIALS")"
if [[ "$REQUIRE_GOOGLE" == "true" && "$google_login_enabled" != "true" && "$google_login_enabled" != "1" ]]; then
  invalid+=("GOOGLE_LOGIN_ENABLED (must be true/1 when --require-google is set)")
fi

if [[ "$google_login_enabled" == "true" || "$google_login_enabled" == "1" || "$REQUIRE_GOOGLE" == "true" ]]; then
  if [[ -z "$google_api_credentials" ]]; then
    invalid+=("GOOGLE_API_CREDENTIALS (required when GOOGLE_LOGIN_ENABLED is true)")
  elif [[ "$google_api_credentials" != *"\"client_id\""* || "$google_api_credentials" != *"\"client_secret\""* ]]; then
    invalid+=("GOOGLE_API_CREDENTIALS (must include web.client_id and web.client_secret JSON fields)")
  fi

  if [[ -n "$google_api_credentials" ]]; then
    if [[ "$google_api_credentials" != *"/api/integrations/googlecalendar/callback"* ]]; then
      invalid+=("GOOGLE_API_CREDENTIALS (redirect_uris should include /api/integrations/googlecalendar/callback)")
    fi
    if [[ "$google_api_credentials" != *"/api/auth/callback/google"* ]]; then
      invalid+=("GOOGLE_API_CREDENTIALS (redirect_uris should include /api/auth/callback/google)")
    fi
  fi
fi

if [[ "$REQUIRE_SSO" == "true" ]]; then
  saml_database_url="$(extract_value "SAML_DATABASE_URL")"
  saml_admins="$(extract_value "SAML_ADMINS")"

  if [[ -z "$saml_database_url" ]]; then
    invalid+=("SAML_DATABASE_URL (required when --require-sso is set)")
  elif [[ "$saml_database_url" != postgres://* && "$saml_database_url" != postgresql://* ]]; then
    invalid+=("SAML_DATABASE_URL (must start with postgres:// or postgresql://)")
  elif [[ "$ALLOW_PLACEHOLDERS" != "true" ]] && has_placeholder "$saml_database_url"; then
    placeholder+=("SAML_DATABASE_URL")
  fi

  if [[ -z "$saml_admins" ]]; then
    invalid+=("SAML_ADMINS (required when --require-sso is set)")
  elif [[ "$saml_admins" != *"@"* ]]; then
    invalid+=("SAML_ADMINS (must include at least one valid admin email)")
  elif [[ "$ALLOW_PLACEHOLDERS" != "true" ]] && has_placeholder "$saml_admins"; then
    placeholder+=("SAML_ADMINS")
  fi
fi

legacy_keys=(
  CALCOM_DEPLOYMENT_KEY
  BASE_URL
  NEXT_PUBLIC_BASE_URL
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
)

for key in "${legacy_keys[@]}"; do
  legacy_value="$(extract_value "$key")"
  if [[ -n "$legacy_value" ]]; then
    invalid+=("${key} (deprecated in upstream; remove this key)")
  fi
done

echo "Checked file: $ENV_FILE"
echo "Profile: $PROFILE"
echo "Required keys: ${#required_keys[@]}"

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required keys:"
  for key in "${missing[@]}"; do
    echo "  - $key"
  done
fi

if [[ ${#placeholder[@]} -gt 0 ]]; then
  echo "Placeholder values still present:"
  for key in "${placeholder[@]}"; do
    echo "  - $key"
  done
fi

if [[ ${#invalid[@]} -gt 0 ]]; then
  echo "Invalid values:"
  for issue in "${invalid[@]}"; do
    echo "  - $issue"
  done
fi

if [[ ${#missing[@]} -gt 0 || ${#placeholder[@]} -gt 0 || ${#invalid[@]} -gt 0 ]]; then
  exit 1
fi

echo "Environment preflight passed."
