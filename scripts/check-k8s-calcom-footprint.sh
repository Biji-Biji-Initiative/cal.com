#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/check-k8s-calcom-footprint.sh [options]

Options:
  --prod-ns <namespace>       Production namespace (default: prod-calcom)
  --staging-ns <namespace>    Staging namespace (default: staging-calcom)
  --dev-ns <namespace>        Dev namespace (default: dev-calcom)
  --expect-prod-hosts <csv>   Expected prod ingress hosts (default: cal.mereka.io,calendar.mereka.io)
  --strict                    Fail if dev/staging namespaces are missing or have no calcom ingress
  -h, --help                  Show help
EOF
}

PROD_NS="${PROD_NS:-prod-calcom}"
STAGING_NS="${STAGING_NS:-staging-calcom}"
DEV_NS="${DEV_NS:-dev-calcom}"
EXPECT_PROD_HOSTS="${EXPECT_PROD_HOSTS:-cal.mereka.io,calendar.mereka.io}"
STRICT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod-ns)
      PROD_NS="${2:-}"
      shift 2
      ;;
    --staging-ns)
      STAGING_NS="${2:-}"
      shift 2
      ;;
    --dev-ns)
      DEV_NS="${2:-}"
      shift 2
      ;;
    --expect-prod-hosts)
      EXPECT_PROD_HOSTS="${2:-}"
      shift 2
      ;;
    --strict)
      STRICT=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[FAIL] Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

pass() { echo "[PASS] $1"; }
warn() { echo "[WARN] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }
info() { echo "[INFO] $1"; }

ns_exists() {
  kubectl get ns "$1" >/dev/null 2>&1
}

calcom_ingress_hosts() {
  local ns="$1"
  kubectl -n "$ns" get ingress -o jsonpath='{range .items[*]}{.spec.rules[*].host}{"\n"}{end}' 2>/dev/null | tr ' ' '\n' | rg -i 'cal|calendar' || true
}

info "Checking Kubernetes context: $(kubectl config current-context 2>/dev/null || echo unknown)"

for target in "$PROD_NS" "$STAGING_NS" "$DEV_NS"; do
  if ns_exists "$target"; then
    pass "Namespace exists: $target"
  else
    if [[ "$target" == "$PROD_NS" || "$STRICT" == "true" ]]; then
      fail "Namespace missing: $target"
    else
      warn "Namespace missing: $target"
    fi
  fi
done

prod_hosts="$(calcom_ingress_hosts "$PROD_NS")"
if [[ -z "$prod_hosts" ]]; then
  fail "No Cal.com ingress hosts found in $PROD_NS"
fi

missing=0
IFS=',' read -r -a expected_hosts <<< "$EXPECT_PROD_HOSTS"
for h in "${expected_hosts[@]}"; do
  h_trimmed="$(echo "$h" | xargs)"
  if echo "$prod_hosts" | rg -Fx "$h_trimmed" >/dev/null 2>&1; then
    pass "Prod host present: $h_trimmed"
  else
    warn "Prod host missing: $h_trimmed"
    missing=1
  fi
done

for ns in "$STAGING_NS" "$DEV_NS"; do
  if ns_exists "$ns"; then
    hosts="$(calcom_ingress_hosts "$ns")"
    if [[ -n "$hosts" ]]; then
      pass "Cal.com ingress detected in $ns"
    else
      if [[ "$STRICT" == "true" ]]; then
        fail "No Cal.com ingress detected in $ns"
      else
        warn "No Cal.com ingress detected in $ns"
      fi
    fi
  fi
done

if [[ "$missing" -eq 1 && "$STRICT" == "true" ]]; then
  fail "Prod host set is incomplete"
fi

pass "K8s Cal.com footprint check completed"
