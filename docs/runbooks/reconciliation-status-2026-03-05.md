# Reconciliation Status - 2026-03-05

## Scope

This status captures the fork reconciliation effort for `Biji-Biji-Initiative/cal.com` against `upstream/main`, with deployment readiness focused on:

- `dev` (RKE2)
- `staging`
- `prod` (GKE)
- Authentik SSO
- Google login
- Google Calendar integration

## Branch Baseline

- Working branch: `reconcile/upstream-main-2026-03-05`
- Base: `upstream/main`
- Reconciled delta commit: `a057608f8f` (`chore(reconcile): reapply fork deploy+gate delta on upstream/main`)
- Result: Final file state matches current fork `main` for tracked files (`git diff main..HEAD` is empty).

## What Was Validated

1. Shell syntax validation passed for deployment and release-gate scripts:
   - `deploy-api-v2.sh`
   - `setup-integrations.sh`
   - `scripts/check-rollout-readiness.sh`
   - `scripts/run-release-gate.sh`
   - `scripts/smoke-check-calcom.sh`
   - `scripts/test-verify-calcom-env.sh`
   - `scripts/verify-calcom-env.sh`
2. Env parser regression tests passed:
   - `scripts/test-verify-calcom-env.sh`
3. Live smoke checks executed against documented public domains.
4. Nonprod web smoke checks:
   - `https://staging.cal.mereka.io` passed web/auth/google/outpost probes.
   - `https://cal.mereka.dev` responds with `308` redirects to staging host for web/auth/google paths (outpost ping still `204`).
5. Added matrix smoke wrapper for repeatable promotion checks:
   - `scripts/smoke-check-matrix.sh`
6. Google OAuth credential readiness:
   - Staging and prod `calcom-env` secrets both contain `GOOGLE_LOGIN_ENABLED=true`.
   - `GOOGLE_API_CREDENTIALS.web.redirect_uris` include required callbacks for:
     - `https://cal.mereka.io/api/integrations/googlecalendar/callback`
     - `https://cal.mereka.io/api/auth/callback/google`
     - `https://staging.cal.mereka.io/api/integrations/googlecalendar/callback`
     - `https://staging.cal.mereka.io/api/auth/callback/google`
7. Web-only release gate status:
   - `scripts/run-release-gate.sh ... --skip-api-v2 --web-url https://cal.mereka.io` passed.
   - `scripts/run-release-gate.sh ... --skip-api-v2 --web-url https://staging.cal.mereka.io` passed.
8. Runtime parity (web):
   - Prod and staging both run `calcom/cal.com:v6.2.0` with `auth-proxy=node:22-alpine`.

## Current Live Blocker

`api-v2.cal.mereka.io` fails TLS handshake during smoke/gate checks.

Observed command:

```bash
scripts/smoke-check-calcom.sh \
  --web-url https://cal.mereka.io \
  --api-url https://api-v2.cal.mereka.io \
  --check-google --check-sso
```

Observed outcome:

- Web auth endpoints: pass
- Google signin/callback endpoints: pass
- Authentik outpost ping: pass (`204`)
- API docs endpoint: fail (`TLS alert handshake failure`)

Additional diagnostics:

- `dig +short A api-v2.cal.mereka.io @1.1.1.1` resolves to Cloudflare anycast IPs (`104.21.27.20`, `172.67.140.213`).
- `curl -4 -I https://api-v2.cal.mereka.io` and `curl -6 -I https://api-v2.cal.mereka.io` both fail during TLS handshake.
- `openssl s_client -connect api-v2.cal.mereka.io:443 -servername api-v2.cal.mereka.io -brief` fails before certificate exchange.
- `gcloud beta run domain-mappings describe --domain=api-v2.cal.mereka.io --region=us-central1 --project=biji-biji-calcom-250825084322` returns `NOT_FOUND`.
- `gcloud beta run domain-mappings describe --domain=api-v2.mereka.io --region=us-central1 --project=biji-biji-calcom-250825084322` also returns `NOT_FOUND`.
- `gcloud compute forwarding-rules list --project bbi-k8` shows `34.177.83.168` attached to a regional external target pool in `asia-southeast1` (same IP used by `cal.mereka.io` / `calendar.mereka.io`).
- `kubectl -n prod-calcom get deploy,svc,ingress` shows only Cal.com web ingress hosts (`cal.mereka.io`, `calendar.mereka.io`) and no `api-v2` deployment/service/ingress.
- `kubectl get ingress -A` shows Cal.com ingress only in namespace `prod-calcom`; no Cal.com ingress currently detected in dev/staging namespaces.
- Control comparison:
  - `cal.mereka.io` and `calendar.mereka.io` complete TLS handshake successfully and present a valid certificate.

Interpretation: TLS failure is at edge/routing/certificate policy level for `api-v2.cal.mereka.io`. Current evidence points to hostname-level edge configuration mismatch (Cloudflare-proxied API host vs direct GCP LB strategy used by web hosts).

Current rollout policy:

- Use web-only gate mode (`--skip-api-v2`) for mainline Cal.com rollout until API v2 runtime and hostname are actually provisioned.
- Keep API v2 checks available and re-enable them as soon as API v2 service + domain mapping/ingress is in place.
- Treat dev/staging Cal.com deployment footprint as an explicit prerequisite using `scripts/check-k8s-calcom-footprint.sh`.
- Treat `cal.mereka.dev` as a redirect alias to staging until a dedicated dev Cal.com environment is intentionally introduced.

## Why Release Is Not Ready Yet

Release gates require both web and API probes to pass. API TLS failure means rollout should remain blocked until edge/certificate routing is fixed for `api-v2.cal.mereka.io`.

## Next 10 Actions (Strict Order)

1. Fix TLS/edge routing for `api-v2.cal.mereka.io` (certificate + proxy chain).
2. Re-run `scripts/smoke-check-calcom.sh` for `cal.mereka.io` + `api-v2.cal.mereka.io`.
3. Re-run `scripts/run-release-gate.sh` with live URLs and secure env files.
4. Execute dev deployment and confirm Authentik login flow end-to-end.
5. Execute dev Google OAuth login end-to-end.
6. Execute dev Google Calendar connect + event creation validation.
7. Promote same artifact/config to staging.
8. Repeat full smoke/auth/calendar checks on staging.
9. Promote to prod with rollback guard.
10. Run post-deploy smoke + booking/calendar validation and record evidence.

## TLS Fix Checklist for `api-v2.cal.mereka.io`

1. Confirm Cloudflare SSL/TLS mode is not misconfigured for this hostname (recommended: Full/Strict with valid origin cert).
2. Verify edge certificate is active and covers `api-v2.cal.mereka.io`.
3. Check for conflicting per-hostname TLS rules (mTLS required, minimum TLS, custom cipher policies).
4. Verify origin target and port are correct and reachable from Cloudflare.
5. Re-test:
   - `curl -I https://api-v2.cal.mereka.io/docs`
   - `scripts/smoke-check-calcom.sh --web-url https://cal.mereka.io --api-url https://api-v2.cal.mereka.io --check-google --check-sso`
