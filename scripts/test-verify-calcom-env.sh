#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY_SCRIPT="$ROOT_DIR/scripts/verify-calcom-env.sh"

tmp_env="$(mktemp "${TMPDIR:-/tmp}/verify-calcom-env.XXXXXX.yaml")"
trap 'rm -f "$tmp_env"' EXIT

cat >"$tmp_env" <<'EOF'
NEXTAUTH_URL: "https://calendar.example.com"
NEXT_PUBLIC_WEBAPP_URL: "https://calendar.example.com"
WEB_APP_URL: "https://calendar.example.com"
NEXTAUTH_SECRET: "test-nextauth-secret"
CALENDSO_ENCRYPTION_KEY: "test-encryption-key"
DATABASE_URL: "postgresql://user:pass@localhost:5432/calendso?host=/cloudsql/project:region:instance&sslmode=disable"
DATABASE_DIRECT_URL: "postgresql://user:pass@localhost:5432/calendso?host=/cloudsql/project:region:instance&sslmode=disable"
GOOGLE_LOGIN_ENABLED: "true"
GOOGLE_API_CREDENTIALS: '{"web":{"client_id":"foo.apps.googleusercontent.com","client_secret":"bar","redirect_uris":["https://calendar.example.com/api/integrations/googlecalendar/callback","https://calendar.example.com/api/auth/callback/google"]}}'
CALCOM_LICENSE_KEY: "59c0bed7-8b21-4280-8514-e022fbfc24c7"
CAL_SIGNATURE_TOKEN: "signature-token"
SAML_DATABASE_URL: "postgresql://user:pass@localhost:5432/saml"
SAML_ADMINS: "admin@example.com"
EOF

echo "[TEST] verify-calcom-env accepts valid web env with query params in DB URLs"
"$VERIFY_SCRIPT" "$tmp_env" --profile web --require-google --require-sso >/dev/null

echo "[TEST] verify-calcom-env rejects deprecated keys"
echo 'BASE_URL: "https://deprecated.example.com"' >>"$tmp_env"
if "$VERIFY_SCRIPT" "$tmp_env" --profile web --require-google --require-sso >/dev/null 2>&1; then
  echo "Expected validation to fail when deprecated key BASE_URL is present" >&2
  exit 1
fi

echo "verify-calcom-env tests passed."
