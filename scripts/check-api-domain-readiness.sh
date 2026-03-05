#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/check-api-domain-readiness.sh --api-url <url> [options]

Options:
  --api-url <url>             API base URL (required)
  --project <id>              GCP project id for Cloud Run domain-mapping check
  --region <region>           Cloud Run region (default: us-central1)
  --skip-domain-mapping       Skip gcloud domain-mapping check
  -h, --help                  Show this help
EOF
}

API_URL=""
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
SKIP_DOMAIN_MAPPING=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --project)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --skip-domain-mapping)
      SKIP_DOMAIN_MAPPING=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[FAIL] Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${API_URL}" ]]; then
  echo "[FAIL] --api-url is required"
  usage
  exit 1
fi

host="$(echo "${API_URL}" | sed -E 's#^https?://([^/]+).*$#\1#')"
if [[ -z "${host}" || "${host}" == "${API_URL}" ]]; then
  echo "[FAIL] Could not parse host from API URL: ${API_URL}"
  exit 1
fi

echo "[INFO] API URL: ${API_URL}"
echo "[INFO] Host: ${host}"

if ! dig +short A "${host}" @1.1.1.1 | grep -q .; then
  echo "[FAIL] Host does not resolve via public DNS: ${host}"
  exit 1
fi
echo "[PASS] DNS A record exists for ${host}"

if ! curl -I --silent --show-error --max-time 20 "${API_URL}/docs" >/dev/null; then
  echo "[FAIL] TLS/HTTP probe failed for ${API_URL}/docs"
  exit 1
fi
echo "[PASS] TLS/HTTP probe succeeded for ${API_URL}/docs"

if [[ "${SKIP_DOMAIN_MAPPING}" == "true" ]]; then
  echo "[INFO] Skipping Cloud Run domain-mapping check"
  exit 0
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[WARN] gcloud not found; skipping domain-mapping check"
  exit 0
fi

if [[ -z "${PROJECT_ID}" ]]; then
  echo "[WARN] --project not provided; skipping domain-mapping check"
  exit 0
fi

if ! gcloud beta run domain-mappings describe \
  --domain "${host}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "[FAIL] No Cloud Run domain mapping found for ${host} (project=${PROJECT_ID}, region=${REGION})"
  exit 1
fi

echo "[PASS] Cloud Run domain mapping exists for ${host}"
