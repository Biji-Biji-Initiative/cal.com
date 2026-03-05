# Upstream Sync And Rollout Runbook

## Goal
Keep this fork close to `calcom/cal.com` while safely rolling updates through `dev (RKE2) -> staging -> prod (GKE)` with data preservation and integration validation.

## Source Of Truth
- Upstream code updates: [`docs/self-hosting/upgrading.mdx`](../self-hosting/upgrading.mdx)
- Migration safety: [`docs/self-hosting/database-migrations.mdx`](../self-hosting/database-migrations.mdx)
- Local deployment references: [`DEPLOYMENT_GUIDE.md`](../../DEPLOYMENT_GUIDE.md)

## Pre-Flight (Always)
1. Sync with upstream:
   - `git fetch upstream`
   - `git checkout main`
   - `git merge --ff-only upstream/main` (or rebase strategy used by your team)
2. Validate env files without leaking secrets:
   - Combined gate (web-only mode, env readiness + optional live smoke): `./scripts/run-release-gate.sh --dev-web ./calcom-k8s.env.example --staging-web ./env-vars-production.example.yaml --prod-web ./env-vars-production.example.yaml --skip-api-v2 --allow-placeholders`
   - Combined gate (with API v2): `./scripts/run-release-gate.sh --dev-web ./calcom-k8s.env.example --staging-web ./env-vars-production.example.yaml --prod-web ./env-vars-production.example.yaml --api-v2 ./env-vars-api-v2.example.yaml --allow-placeholders`
   - Regression test for env parser/deprecated-key guard: `./scripts/test-verify-calcom-env.sh`
   - Template sanity: `./scripts/verify-calcom-env.sh env-vars-production.example.yaml --profile web --allow-placeholders --require-google --require-sso`
   - Template sanity: `./scripts/verify-calcom-env.sh env-vars-api-v2.example.yaml --profile api-v2 --allow-placeholders`
   - Full readiness check (web-only mode): `./scripts/check-rollout-readiness.sh --dev-web ./calcom-k8s.env.example --staging-web ./env-vars-production.example.yaml --prod-web ./env-vars-production.example.yaml --skip-api-v2 --allow-placeholders`
   - Full readiness check (with API v2): `./scripts/check-rollout-readiness.sh --dev-web ./calcom-k8s.env.example --staging-web ./env-vars-production.example.yaml --prod-web ./env-vars-production.example.yaml --api-v2 ./env-vars-api-v2.example.yaml --allow-placeholders`
   - API domain readiness (DNS + TLS; optional Cloud Run mapping check when API host is Cloud Run-backed): `./scripts/check-api-domain-readiness.sh --api-url https://<api-domain> --project <gcp-project-id> --region us-central1`
   - Real deploy file (from secret manager export): `./scripts/verify-calcom-env.sh /path/to/prod.env.yaml --profile web --require-google --require-sso`
3. Ensure no placeholders before deploy:
   - No `REPLACE_WITH_*` values
   - `NEXT_PUBLIC_IS_E2E` must be `false`
4. Backup production database:
   - Create snapshot/backup
   - Verify restore path (staging restore drill)
5. Confirm Cal.com footprint exists in target clusters/namespaces:
   - `./scripts/check-k8s-calcom-footprint.sh --prod-ns prod-calcom --staging-ns staging-calcom --dev-ns dev-calcom`
   - Use `--strict` to hard-fail if dev/staging are missing before promotion.

## Rollout Sequence
1. **Dev (RKE2)**
   - Deploy new image/tag
   - Run smoke tests
2. **Staging**
   - Run `yarn workspace @calcom/prisma db-deploy`
   - Deploy image/tag
   - Execute integration matrix (below)
3. **Prod (GKE)**
   - Confirm staging passed
   - Apply migration (`db-deploy`)
   - Roll out with progressive traffic shift
   - Monitor logs/errors/latency

## Integration Validation Matrix
1. Authentik SSO login succeeds (new + returning user).
2. Google Login succeeds.
3. Google Calendar connect succeeds.
4. Booking creation works end-to-end and creates calendar event.
5. Existing users/bookings remain accessible after migration.
6. Baseline HTTP smoke checks pass:
   - `./scripts/smoke-check-calcom.sh --web-url https://<web-domain> --api-url https://<api-domain> --check-google --check-sso`
   - Multi-environment matrix: `./scripts/smoke-check-matrix.sh --prod-url https://cal.mereka.io --staging-url https://staging.cal.mereka.io --dev-url https://cal.mereka.dev`
   - Combined gate with live smoke:
   - Web-only: `./scripts/run-release-gate.sh --dev-web /secure/dev-web.yaml --staging-web /secure/staging-web.yaml --prod-web /secure/prod-web.yaml --skip-api-v2 --web-url https://<web-domain>`
   - With API v2: `./scripts/run-release-gate.sh --dev-web /secure/dev-web.yaml --staging-web /secure/staging-web.yaml --prod-web /secure/prod-web.yaml --api-v2 /secure/prod-api-v2.yaml --web-url https://<web-domain> --api-url https://<api-domain> --gcp-project <gcp-project-id> --gcp-region us-central1`
   - Optional CI execution: trigger `.github/workflows/smoke-check.yml` with target URLs.

### Quick Probe Commands (Read-only)
```bash
curl -I https://cal.mereka.io/api/auth/signin
curl -I https://cal.mereka.io/api/auth/signin/google
curl -I https://cal.mereka.io/outpost.goauthentik.io/ping
curl -I https://calendar.mereka.io/api/auth/signin/google
```
Expected signals:
- Auth endpoints generally return redirect statuses (`302/307`) when auth flow is wired.
- Google callback route should return redirect/auth-required status (`302/400/401`) instead of transport errors.
- Outpost ping should return `204` when Authentik outpost routing is healthy.

## Data Preservation Rules
1. Never run destructive migration commands in production.
2. Use `db-deploy` in production; reserve `db-migrate` for development.
3. Keep backup + restore verification before every production schema change.
4. If migration fails, stop rollout and restore from snapshot.

## Release Gate (Definition Of Done)
1. **Dev (RKE2)**:
   - App is reachable on expected URL.
   - Authentik login works for a test user.
   - Google login works.
   - Google Calendar connect + disconnect both succeed.
2. **Staging**:
   - All Dev checks pass on staging URL.
   - Existing seeded users and historical bookings are still readable after migration.
   - New booking creates expected calendar event.
3. **Prod (GKE)**:
   - All staging checks pass on production URL.
   - Error rate and latency remain within baseline after rollout.
   - No schema/data regression observed in first post-deploy smoke window.
4. **Secrets (Infisical/Secret Manager)**:
   - Required keys are present before deploy export.
   - `scripts/verify-calcom-env.sh` and `scripts/check-rollout-readiness.sh` pass on deploy files.
5. **Go/No-Go Rule**:
   - Do not promote `dev -> staging` or `staging -> prod` until all checks for current environment are green.

## Rollback Plan
1. Stop traffic increase to new revision.
2. Route traffic back to previous known-good revision/image.
3. Restore DB only if schema/data corruption is confirmed.
4. Capture incident notes and patch before retry.

## Known Production Blocker Pattern
1. Symptom:
   - Deployment shows `ReplicaFailure=True` with Kyverno event:
   - `require-drop-all-capabilities ... validation failure: Containers must drop ALL capabilities`
2. Cause:
   - Pod/container `securityContext` does not satisfy cluster policy.
3. Fix at GitOps source (not runtime patch loop):
   - Add container security context fields required by policy (for all app/init/sidecar containers):
   - `allowPrivilegeEscalation: false`
   - `capabilities.drop: ["ALL"]`
   - `seccompProfile.type: RuntimeDefault`
4. Validation:
   - `kubectl -n <ns> describe deploy <name>` no longer shows policy violation events.
   - Deployment reaches desired replica count (`updated=desired`, `available=desired`).
5. Rollback:
   - Revert the GitOps commit changing security context and resync application.

## Known API v2 Edge Blocker Pattern
1. Symptom:
   - `scripts/smoke-check-calcom.sh --web-url https://cal.mereka.io --api-url https://api-v2.cal.mereka.io` fails with:
   - `TLS connect error ... alert handshake failure` on `https://api-v2.cal.mereka.io/docs`.
2. Cause:
   - API v2 hostname is routed/proxied incorrectly at DNS/edge, or API v2 service/ingress is missing.
3. Read-only triage sequence:
   - `dig +short A api-v2.cal.mereka.io @1.1.1.1`
   - `curl -I https://api-v2.cal.mereka.io`
   - `./scripts/check-api-domain-readiness.sh --api-url https://api-v2.cal.mereka.io --project <gcp-project-id> --region us-central1`
   - `kubectl -n prod-calcom get deploy,svc,ingress | grep -i api`
4. Fix:
   - Ensure API v2 runtime exists (service + ingress/domain mapping).
   - Ensure DNS uses the intended origin path (DNS-only when required by ingress TLS strategy).
5. Validation:
   - `scripts/smoke-check-calcom.sh --web-url https://cal.mereka.io --api-url https://api-v2.cal.mereka.io` passes required checks.

## Minimal-Maintenance Policy
1. Keep custom fork changes small and isolated.
2. Prefer config/infrastructure overrides over source-code divergence.
3. Run upstream sync on a fixed cadence (weekly/biweekly).
4. Treat secrets as external-only (Infisical/secret manager), never in git.
5. Keep CI drift guard active: [`.github/workflows/upstream-drift.yml`](../../.github/workflows/upstream-drift.yml).
